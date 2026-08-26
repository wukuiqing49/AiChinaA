import pandas as pd

from pipeline.storage.quote_store import QuoteStore


def _quotes() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "code": ["000001", "000001", "000001"],
            "trade_date": ["2026-08-20", "2026-08-21", "2026-08-22"],
            "open": [10.0, 10.5, 10.0],
            "high": [10.5, 9.9, 10.2],
            "low": [9.8, 10.0, 10.1],
            "close": [10.2, 10.2, 0.0],
            "volume": [1000, 1200, 1300],
            "amount": [10200, 12240, 13130],
            "pct_change": [1.0, 0.0, -1.0],
            "turnover_rate": [0.5, 0.6, 0.7],
        }
    )


def test_quote_store_quarantines_invalid_ohlc_and_is_idempotent(tmp_path) -> None:
    store = QuoteStore(tmp_path / "quotes.sqlite")
    store.initialize()

    first = store.ingest(
        _quotes(),
        source="test/provider",
        price_adjustment="qfq",
        fetched_at="2026-08-26T00:00:00Z",
    )
    second = store.ingest(
        _quotes().iloc[:1],
        source="test/provider",
        price_adjustment="qfq",
        fetched_at="2026-08-27T00:00:00Z",
    )

    assert first.accepted_rows == 1
    assert first.quarantined_rows == 2
    assert second.accepted_rows == 1
    assert store.quote_count() == 1
    assert store.quarantine_count() == 2
