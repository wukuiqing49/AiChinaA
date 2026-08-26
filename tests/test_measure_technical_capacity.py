import pandas as pd

from pipeline.jobs.measure_technical_capacity import measure_technical_capacity


def test_technical_capacity_measurement_keeps_unavailable_scores_out_of_total() -> None:
    dates = pd.date_range("2025-01-01", periods=80, freq="B").strftime("%Y-%m-%d")
    quotes = pd.concat(
        [
            pd.DataFrame(
                {
                    "code": code,
                    "trade_date": dates,
                    "close": range(10, 90),
                    "volume": range(1, 81),
                }
            )
            for code in ("000001", "000002")
        ],
        ignore_index=True,
    )

    actual = measure_technical_capacity(quotes, expected_rows=1000, price_adjustment="qfq")

    assert actual["factor_rows"] == 160
    assert actual["score_rows"] == 160
    assert actual["r2_technical_archive_estimate_bytes"] > 0
    assert actual["unavailable_dimensions"] == ["score_valuation", "score_quality", "score_growth"]
