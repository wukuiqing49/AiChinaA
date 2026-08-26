from __future__ import annotations

import pandas as pd

from pipeline.jobs.build_screener import build_payload


class FakeProvider:
    def get_stock_list(self) -> pd.DataFrame:
        return pd.DataFrame(
            {
                "代码": ["600001", "000001"],
                "名称": ["Alpha", "Beta"],
                "最新价": [12.0, 8.0],
                "涨跌幅": [1.2, -0.4],
                "换手率": [2.0, 1.0],
            }
        )

    def get_daily_quotes(
        self, code: str, start_date: str, end_date: str, adjust: str
    ) -> pd.DataFrame:
        dates = pd.date_range("2026-01-01", periods=100, freq="D")
        base = 10 if code == "600001" else 7
        return pd.DataFrame(
            {
                "code": code,
                "trade_date": dates.strftime("%Y-%m-%d"),
                "close": [base + index * 0.02 for index in range(100)],
                "volume": [1000 + index for index in range(100)],
            }
        )

    def normalize_daily_quotes(self, frame: pd.DataFrame, code: str) -> pd.DataFrame:
        return frame


def test_build_payload_creates_publisher_shape() -> None:
    payload, failures = build_payload(
        FakeProvider(),
        start_date="2026-01-01",
        end_date="2026-04-30",
        max_stocks=0,
        workers=2,
    )

    assert not failures
    assert payload["tradeDate"] == "2026-04-10"
    assert len(payload["stocks"]) == 2
    assert {row["market"] for row in payload["stocks"]} == {"SH", "SZ"}
    assert {"ret20d", "scoreTotal", "volatility20"}.issubset(payload["stocks"][0])
