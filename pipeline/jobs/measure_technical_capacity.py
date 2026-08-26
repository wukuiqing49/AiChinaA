from __future__ import annotations

import argparse
import gzip
import json
from datetime import datetime
from pathlib import Path

import pandas as pd

from pipeline.calculations.technical import calculate_technical_factors, score_technical_factors
from pipeline.jobs.estimate_capacity import read_quote_samples


def measure_technical_capacity(
    quotes: pd.DataFrame,
    *,
    expected_rows: int,
    price_adjustment: str,
) -> dict[str, object]:
    factors = calculate_technical_factors(quotes, price_adjustment=price_adjustment)
    scores = score_technical_factors(factors)
    factor_bytes = _gzip_json_bytes(factors)
    score_bytes = _gzip_json_bytes(scores)
    return {
        "sample_quote_rows": len(quotes.index),
        "factor_rows": len(factors.index),
        "score_rows": len(scores.index),
        "factor_gzip_bytes": factor_bytes,
        "score_gzip_bytes": score_bytes,
        "r2_technical_archive_estimate_bytes": round(
            (factor_bytes + score_bytes) / len(factors.index) * expected_rows
        ),
        "score_dimensions": [
            "score_trend",
            "score_momentum",
            "score_volume_price",
            "score_risk",
        ],
        "unavailable_dimensions": ["score_valuation", "score_quality", "score_growth"],
    }


def _gzip_json_bytes(frame: pd.DataFrame) -> int:
    payload = frame.to_json(orient="records", force_ascii=False, date_format="iso")
    return len(gzip.compress(payload.encode("utf-8"), compresslevel=9))


def write_report(measurement: dict[str, object], report_dir: Path) -> tuple[Path, Path]:
    report_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    json_path = report_dir / f"technical-score-capacity-{stamp}.json"
    markdown_path = report_dir / f"technical-score-capacity-{stamp}.md"
    json_path.write_text(json.dumps(measurement, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [
        "# Technical Factor And Score Capacity",
        "",
        "This is a real qfq-price measurement. Valuation, quality, and growth scores remain null.",
        "",
        "| Metric | Value |",
        "| --- | ---: |",
        f"| Sample quote rows | {measurement['sample_quote_rows']:,} |",
        f"| Factor rows | {measurement['factor_rows']:,} |",
        f"| Score rows | {measurement['score_rows']:,} |",
        f"| Factor gzip size | {_format_bytes(int(measurement['factor_gzip_bytes']))} |",
        f"| Score gzip size | {_format_bytes(int(measurement['score_gzip_bytes']))} |",
        (
            "| Ten-year R2 technical archive estimate | "
            f"{_format_bytes(int(measurement['r2_technical_archive_estimate_bytes']))} |"
        ),
    ]
    markdown_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return json_path, markdown_path


def _format_bytes(value: int) -> str:
    return f"{value / 1024 / 1024 / 1024:.2f} GiB"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Measure qfq technical factor and score archive size."
    )
    parser.add_argument(
        "--sample-dir",
        type=Path,
        default=Path("data/staging/provider-probe/quotes"),
    )
    parser.add_argument("--report-dir", type=Path, default=Path("reports"))
    parser.add_argument("--universe-size", type=int, default=5500)
    parser.add_argument("--trading-days-per-year", type=int, default=244)
    parser.add_argument("--years", type=int, default=10)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    expected_rows = args.universe_size * args.trading_days_per_year * args.years
    measurement = measure_technical_capacity(
        read_quote_samples(args.sample_dir),
        expected_rows=expected_rows,
        price_adjustment="qfq",
    )
    json_path, markdown_path = write_report(measurement, args.report_dir)
    print(json.dumps(measurement, ensure_ascii=False))
    print(f"JSON report: {json_path}")
    print(f"Markdown report: {markdown_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
