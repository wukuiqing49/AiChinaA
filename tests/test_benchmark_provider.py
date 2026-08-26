from datetime import date

import pandas as pd

from pipeline.jobs.benchmark_provider import (
    QuoteBenchmarkResult,
    build_summary,
    recent_trade_date_range,
    select_diverse_codes,
)


def test_recent_trade_date_range_uses_calendar_not_weekdays() -> None:
    calendar = pd.DataFrame({"trade_date": ["2026-08-20", "2026-08-21", "2026-08-24"]})

    assert recent_trade_date_range(calendar, 2, date(2026, 8, 24)) == ("2026-08-21", "2026-08-24")


def test_select_diverse_codes_round_robins_target_boards() -> None:
    stocks = pd.DataFrame(
        {
            "code": [
                "600000",
                "600001",
                "000001",
                "000002",
                "300001",
                "300002",
                "688001",
                "688002",
                "920001",
                "920002",
            ]
        }
    )

    actual = select_diverse_codes(stocks, 5)

    assert actual == ["600000", "000001", "300001", "688001", "920001"]


def test_benchmark_summary_reports_row_coverage_separately_from_code_coverage() -> None:
    results = [
        QuoteBenchmarkResult("000001", "passed", 1, row_count=20),
        QuoteBenchmarkResult("000002", "warning", 1, row_count=18),
    ]

    actual = build_summary(results, "2026-08-01", "2026-08-25", 20)

    assert actual["code_coverage"] == 1.0
    assert actual["full_coverage_codes"] == 1
    assert actual["row_coverage"] == 0.95
