from datetime import date
from io import BytesIO
import json

import pandas as pd
import pytest

from pipeline.calculations.technical import calculate_technical_factors
from pipeline.jobs.fetch_financials import fetch_report, num, report_periods
from pipeline.jobs.trading_day import is_trading_day
from pipeline.publishing import publish_dataset


@pytest.mark.parametrize("prices,expected", [([100.0] * 60 + [50.0] * 60, 0),
                                                   ([100.0] * 59 + [80.0], -0.2),
                                                   ([50.0] * 30 + [100.0] * 30, 0)])
def test_drawdown_uses_only_ordered_prices_in_current_window(prices, expected):
    quotes = pd.DataFrame({"code": "600001", "trade_date": pd.date_range("2026-01-01", periods=len(prices)),
                           "close": prices, "volume": 100})
    result = calculate_technical_factors(quotes, price_adjustment="qfq")
    assert result.iloc[-1]["max_drawdown_60"] == pytest.approx(expected)


def test_financial_outer_join_is_json_safe_and_excludes_future_disclosures():
    class Source:
        def stock_yjbb_em(self, **_):
            return pd.DataFrame({"股票代码": ["600001", "600003"], "最新公告日期": ["2026-10-20", "2026-11-01"],
                                 "净资产收益率": [12, 15], "营业总收入-同比增长": [1, 2], "净利润-同比增长": [3, 4],
                                 "销售毛利率": [None, 10], "营业总收入-营业总收入": [100, 200], "净利润-净利润": [10, 20]})

        def stock_zcfz_em(self, **_):
            return pd.DataFrame({"股票代码": ["600002"], "资产负债率": [30]})

    rows = fetch_report(Source(), "20260930", date(2026, 10, 27))
    assert len(rows) == 1
    assert rows[0]["debtRatio"] is None
    assert rows[0]["reportDate"] == "2026-09-30"
    json.dumps(rows, allow_nan=False)
    assert num(float("inf")) is None
    assert "20260630" in report_periods(date(2026, 10, 27))


def test_calendar_distinguishes_holidays_and_incomplete_data():
    calendar = pd.DataFrame({"trade_date": ["2026-10-26", "2026-10-27", "2026-10-30"]})
    assert is_trading_day(calendar, "2026-10-27")
    assert not is_trading_day(calendar, "2026-10-28")
    with pytest.raises(RuntimeError):
        is_trading_day(calendar, "2026-11-01")


def test_publisher_sends_only_missing_bounded_chunks_and_resumes_same_artifact(monkeypatch):
    sent = []

    def transport(request, timeout):
        body = json.loads(request.data)
        sent.append(body)
        result = {"runId": body["runId"], "status": "completed" if body["operation"] == "commit" else "running"}
        if body["operation"] == "begin":
            result["acceptedChunks"] = [0]
        return BytesIO(json.dumps(result).encode())

    monkeypatch.setattr("pipeline.jobs.publish_screener.urlopen", transport)
    payload = {"dataDate": "2026-10-27", "source": "test", "rows": [{"code": f"{600001+i}", "pb": 1} for i in range(25)]}
    publish_dataset(payload, url="https://example.test/publish-valuation", secret="secret")
    assert [item["operation"] for item in sent] == ["begin", "chunk", "chunk", "commit"]
    assert [len(item["payload"]["rows"]) for item in sent if item["operation"] == "chunk"] == [10, 5]
    assert "rows" not in sent[0]["meta"]
    run_id = sent[0]["runId"]
    sent.clear()
    publish_dataset(payload, url="https://example.test/publish-valuation", secret="secret")
    assert sent[0]["runId"] == run_id


def test_publish_rejects_unknown_or_nonterminal_server_results(monkeypatch):
    monkeypatch.setattr("pipeline.jobs.publish_screener.urlopen", lambda *_args, **_kwargs: BytesIO(b'{"status":"mystery"}'))
    with pytest.raises(RuntimeError, match="invalid publish"):
        publish_dataset({"rows": [{"code": "600001"}]}, url="https://example.test/publish-valuation", secret="secret")
