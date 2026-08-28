from __future__ import annotations

import pandas as pd
import pytest

from pipeline.jobs.probe_provider import _financial_asof_warning
from pipeline.providers.akshare_provider import AkShareProvider


class FakeAkShare:
    def stock_zh_a_hist(self, **_: object) -> pd.DataFrame:
        return pd.DataFrame(
            {
                "日期": ["2026-08-24", "2026-08-25"],
                "开盘": [10.0, 10.5],
                "最高": [10.8, 11.1],
                "最低": [9.9, 10.4],
                "收盘": [10.5, 11.0],
                "成交量": [1000, 1200],
                "成交额": [10500, 13200],
                "涨跌幅": [1.2, 4.8],
                "换手率": [0.5, 0.6],
            }
        )


class FakeFinancialAkShare:
    def __init__(self) -> None:
        self.symbol: str | None = None

    def stock_financial_analysis_indicator_em(self, symbol: str) -> pd.DataFrame:
        self.symbol = symbol
        return pd.DataFrame(
            {
                "REPORT_DATE": ["2026-06-30", "2019-12-31"],
                "NOTICE_DATE": ["2026-08-15", "2020-03-01"],
                "ROEJQ": [10.2, 8.1],
            }
        )


class FakeEtfAkShare:
    def fund_etf_spot_em(self) -> pd.DataFrame:
        return pd.DataFrame(
            {
                "code": ["510300", "159915"],
                "name": ["CSI 300 ETF", "Growth ETF"],
            }
        )


def test_normalize_daily_quotes_preserves_code_and_numeric_columns() -> None:
    provider = AkShareProvider(client=FakeAkShare())
    source = provider.get_daily_quotes("000001", "20260824", "20260825")

    actual = provider.normalize_daily_quotes(source, "000001")

    assert list(actual.columns) == [
        "code",
        "trade_date",
        "open",
        "high",
        "low",
        "close",
        "volume",
        "amount",
        "pct_change",
        "turnover_rate",
    ]
    assert actual.loc[0, "code"] == "000001"
    assert actual.loc[1, "trade_date"] == "2026-08-25"
    assert actual.loc[1, "close"] == pytest.approx(11.0)


def test_normalize_daily_quotes_rejects_schema_drift() -> None:
    provider = AkShareProvider(client=FakeAkShare())
    frame = pd.DataFrame({"日期": ["2026-08-25"], "收盘": [11.0]})

    with pytest.raises(ValueError, match="daily quote schema missing columns"):
        provider.normalize_daily_quotes(frame, "000001")


def test_normalize_tencent_daily_quotes_derives_pct_change() -> None:
    provider = AkShareProvider(client=FakeAkShare())
    frame = pd.DataFrame(
        {
            "date": ["2026-08-24", "2026-08-25"],
            "open": [10.0, 10.5],
            "high": [10.8, 11.1],
            "low": [9.9, 10.4],
            "close": [10.5, 11.0],
            "volume": [1000, 1200],
            "amount": [10500, 13200],
            "turnover": [0.005, 0.006],
        }
    )
    frame.attrs["source"] = "akshare/tencent"
    frame.attrs["price_adjustment"] = "qfq"

    actual = provider.normalize_daily_quotes(frame, "000001")

    assert actual.loc[1, "turnover_rate"] == pytest.approx(0.6)
    assert actual.loc[1, "pct_change"] == pytest.approx(4.7619048)
    assert actual.attrs["source"] == "akshare/tencent"
    assert actual.attrs["price_adjustment"] == "qfq"


def test_sina_symbol_conversion_supports_beijing_exchange() -> None:
    assert AkShareProvider._to_sina_symbol("920002") == "bj920002"
    assert AkShareProvider._to_sina_symbol("600519") == "sh600519"
    assert AkShareProvider._to_sina_symbol("300750") == "sz300750"


def test_etf_universe_and_exchange_symbols_are_normalized() -> None:
    provider = AkShareProvider(client=FakeEtfAkShare())

    actual = provider.get_etf_list()

    assert actual.to_dict(orient="records") == [
        {"code": "510300", "name": "CSI 300 ETF"},
        {"code": "159915", "name": "Growth ETF"},
    ]
    assert AkShareProvider._to_tx_symbol("510300") == "sh510300"
    assert AkShareProvider._to_sina_symbol("159915") == "sz159915"


def test_financial_probe_requires_announcement_date_for_historical_scoring() -> None:
    frame = pd.DataFrame({"日期": ["2026-06-30"], "净资产收益率": [10.0]})
    warning = _financial_asof_warning(frame)

    assert warning is not None
    assert _financial_asof_warning(pd.DataFrame({"公告日期": ["2026-08-20"]})) is None
    assert _financial_asof_warning(pd.DataFrame({"NOTICE_DATE": ["2026-08-20"]})) is None


def test_financial_reports_prefer_eastmoney_and_keep_announcement_dates() -> None:
    client = FakeFinancialAkShare()
    provider = AkShareProvider(client=client)

    actual = provider.get_financial_reports("600519", "2020")

    assert client.symbol == "600519.SH"
    assert actual["NOTICE_DATE"].tolist() == ["2026-08-15"]
    assert actual.attrs["source"] == "akshare/eastmoney"


def test_eastmoney_symbol_conversion_supports_all_target_boards() -> None:
    assert AkShareProvider._to_eastmoney_symbol("600519") == "600519.SH"
    assert AkShareProvider._to_eastmoney_symbol("300750") == "300750.SZ"
    assert AkShareProvider._to_eastmoney_symbol("920002") == "920002.BJ"
