from __future__ import annotations

import pandas as pd

from pipeline.jobs.estimate_capacity import estimate_quote_capacity


def test_estimate_quote_capacity_uses_real_sample_shape(tmp_path) -> None:
    frame = pd.DataFrame(
        {
            "code": ["000001", "000001"],
            "trade_date": ["2026-08-24", "2026-08-25"],
            "open": [10.0, 10.5],
            "high": [10.8, 11.1],
            "low": [9.9, 10.4],
            "close": [10.5, 11.0],
            "volume": [1000, 1200],
            "amount": [10500, 13200],
            "pct_change": [1.2, 4.8],
            "turnover_rate": [0.5, 0.6],
        }
    )

    estimate = estimate_quote_capacity(
        frame=frame,
        sqlite_path=tmp_path / "capacity" / "quotes.sqlite",
        universe_size=10,
        trading_days_per_year=2,
        years=3,
    )

    assert estimate.sample_rows == 2
    assert estimate.expected_rows == 60
    assert estimate.r2_quotes_estimate_bytes > estimate.gzip_json_bytes
    assert estimate.sqlite_quotes_estimate_bytes > estimate.sqlite_bytes
