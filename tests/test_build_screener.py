from __future__ import annotations

import json
from datetime import UTC, datetime

import pandas as pd

from pipeline.jobs.build_screener import _apply_realtime_quotes, build_payload


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
    assert {row["tradeDate"] for row in payload["stocks"]} == {"2026-04-10"}
    assert {
        "ret20d",
        "scoreTotal",
        "scoreTrend",
        "scoreMomentum",
        "scoreVolumePrice",
        "scoreRisk",
        "volatility20",
    }.issubset(payload["stocks"][0])


def test_realtime_quotes_use_typed_keys_and_preserve_history_date(tmp_path) -> None:
    payload = {
        "stocks": [
            {
                "code": "000001",
                "instrumentType": "stock",
                "tradeDate": "2026-08-27",
                "close": 10,
                "pctChange": 0,
                "quoteDate": None,
                "quoteTime": None,
                "quoteSource": None,
            }
        ],
        "indices": [
            {
                "code": "sh000001",
                "tradeDate": "2026-08-27",
                "close": 3800,
                "pctChange": 0,
                "quoteDate": None,
                "quoteTime": None,
                "quoteSource": None,
            }
        ],
    }
    quote_file = tmp_path / "quotes.json"
    quote_file.write_text(
        json.dumps(
            {
                "generatedAt": "2026-08-28T07:00:00+00:00",
                "quotes": {
                    "stock:000001": {
                        "close": 11,
                        "pctChange": 1.2,
                        "quoteDate": "2026-08-28",
                        "quoteTime": "15:00:00",
                    },
                    "index:sh000001": {
                        "close": 3912,
                        "pctChange": 0.59,
                        "quoteDate": "2026-08-28",
                        "quoteTime": "15:00:01",
                    },
                },
            }
        ),
        encoding="utf-8",
    )

    _apply_realtime_quotes(
        payload, quote_file, now=datetime(2026, 8, 28, 8, 0, tzinfo=UTC)
    )

    assert payload["stocks"][0]["close"] == 11
    assert payload["indices"][0]["close"] == 3912
    assert payload["stocks"][0]["tradeDate"] == "2026-08-27"
    assert payload["stocks"][0]["quoteDate"] == "2026-08-28"


def test_realtime_index_clears_indicators_when_history_is_old(tmp_path) -> None:
    payload = {
        "stocks": [],
        "indices": [
            {
                "code": "sh000922",
                "tradeDate": "2019-01-30",
                "close": 1000,
                "pctChange": 0,
                "ret20d": 2,
                "ma20Slope": 0.1,
                "volatility20": 0.2,
            }
        ],
    }
    quote_file = tmp_path / "quotes.json"
    quote_file.write_text(
        json.dumps(
            {
                "generatedAt": "2026-08-28T07:00:00+00:00",
                "quotes": {
                    "index:sh000922": {
                        "close": 4000,
                        "pctChange": -0.6,
                        "quoteDate": "2026-08-28",
                        "quoteTime": "15:00:00",
                    }
                },
            }
        ),
        encoding="utf-8",
    )

    _apply_realtime_quotes(
        payload, quote_file, now=datetime(2026, 8, 28, 8, 0, tzinfo=UTC)
    )

    index = payload["indices"][0]
    assert index["close"] == 4000
    assert index["ret20d"] is None
    assert index["ma20Slope"] is None


def test_realtime_quotes_ignore_stale_snapshot(tmp_path) -> None:
    payload = {
        "stocks": [
            {
                "code": "600001",
                "instrumentType": "stock",
                "tradeDate": "2026-08-27",
                "close": 10,
                "pctChange": 0,
            }
        ],
        "indices": [],
    }
    quote_file = tmp_path / "quotes.json"
    quote_file.write_text(
        json.dumps(
            {
                "generatedAt": "2026-08-27T00:00:00+00:00",
                "quotes": {
                    "stock:600001": {
                        "close": 99,
                        "pctChange": 50,
                        "quoteDate": "2026-08-27",
                        "quoteTime": "15:00:00",
                    }
                },
            }
        ),
        encoding="utf-8",
    )

    _apply_realtime_quotes(
        payload, quote_file, now=datetime(2026, 8, 28, 8, 0, tzinfo=UTC)
    )

    assert payload["stocks"][0]["close"] == 10
