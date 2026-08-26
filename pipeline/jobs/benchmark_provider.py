from __future__ import annotations

import argparse
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

import pandas as pd

from pipeline.jobs.probe_provider import _quote_warning
from pipeline.providers.akshare_provider import AkShareProvider


@dataclass(frozen=True)
class QuoteBenchmarkResult:
    code: str
    status: str
    duration_ms: int
    row_count: int | None = None
    source: str | None = None
    warning: str | None = None
    error: str | None = None


def recent_trade_date_range(calendar: pd.DataFrame, days: int, as_of: date) -> tuple[str, str]:
    if "trade_date" not in calendar.columns:
        raise ValueError("trade calendar is missing trade_date")
    dates = pd.to_datetime(calendar["trade_date"], errors="coerce").dropna().dt.date
    available = dates[dates <= as_of]
    if len(available) < days:
        raise ValueError(f"trade calendar has fewer than {days} dates through {as_of.isoformat()}")
    return available.iloc[-days].isoformat(), available.iloc[-1].isoformat()


def select_diverse_codes(stock_list: pd.DataFrame, sample_size: int) -> list[str]:
    if "code" not in stock_list.columns:
        raise ValueError("stock list is missing code")
    codes = sorted({str(value).zfill(6) for value in stock_list["code"].dropna()})
    board_filters = (
        lambda code: code.startswith("6") and not code.startswith("688"),
        lambda code: code.startswith(("0", "2")),
        lambda code: code.startswith("3"),
        lambda code: code.startswith("688"),
        lambda code: code.startswith(("4", "8", "9")),
    )
    groups = [[code for code in codes if matches(code)] for matches in board_filters]
    selected: list[str] = []
    positions = [0] * len(groups)
    while len(selected) < sample_size:
        progressed = False
        for index, group in enumerate(groups):
            if positions[index] >= len(group):
                continue
            candidate = group[positions[index]]
            positions[index] += 1
            if candidate not in selected:
                selected.append(candidate)
                progressed = True
            if len(selected) == sample_size:
                break
        if not progressed:
            break
    if len(selected) < sample_size:
        raise ValueError(f"stock list only supplied {len(selected)} selectable A-share codes")
    return selected


def benchmark_quotes(
    provider: AkShareProvider,
    codes: list[str],
    start_date: str,
    end_date: str,
    expected_rows: int,
    workers: int,
    checkpoint_path: Path,
) -> list[QuoteBenchmarkResult]:
    checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
    results: list[QuoteBenchmarkResult] = []
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(
                _benchmark_one, provider, code, start_date, end_date, expected_rows
            ): code
            for code in codes
        }
        for future in as_completed(futures):
            results.append(future.result())
            _write_checkpoint(results, checkpoint_path)
    return sorted(results, key=lambda item: item.code)


def _benchmark_one(
    provider: AkShareProvider,
    code: str,
    start_date: str,
    end_date: str,
    expected_rows: int,
) -> QuoteBenchmarkResult:
    started = time.perf_counter()
    try:
        compact_start_date = start_date.replace("-", "")
        compact_end_date = end_date.replace("-", "")
        raw = provider.get_daily_quotes(code, compact_start_date, compact_end_date)
        normalized = provider.normalize_daily_quotes(raw, code)
        warning = _quote_warning(normalized)
        if len(normalized.index) != expected_rows:
            coverage_warning = (
                f"Expected {expected_rows} rows but received {len(normalized.index)}."
            )
            warning = f"{warning} {coverage_warning}" if warning else coverage_warning
        return QuoteBenchmarkResult(
            code=code,
            status="warning" if warning else "passed",
            duration_ms=round((time.perf_counter() - started) * 1000),
            row_count=len(normalized.index),
            source=normalized.attrs.get("source"),
            warning=warning,
        )
    except Exception as error:
        return QuoteBenchmarkResult(
            code=code,
            status="failed",
            duration_ms=round((time.perf_counter() - started) * 1000),
            error=f"{type(error).__name__}: {error}",
        )


def _write_checkpoint(results: list[QuoteBenchmarkResult], path: Path) -> None:
    payload = {"completed": len(results), "results": [asdict(result) for result in results]}
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def build_summary(
    results: list[QuoteBenchmarkResult],
    start_date: str,
    end_date: str,
    expected_rows_per_code: int,
) -> dict[str, object]:
    completed = [result for result in results if result.status in {"passed", "warning"}]
    expected_rows = expected_rows_per_code * len(results)
    actual_rows = sum(result.row_count or 0 for result in completed)
    return {
        "requested_interval": {"start_date": start_date, "end_date": end_date},
        "sample_size": len(results),
        "completed": len(completed),
        "code_coverage": round(len(completed) / len(results), 4) if results else 0.0,
        "full_coverage_codes": sum(
            (result.row_count or 0) == expected_rows_per_code for result in completed
        ),
        "expected_rows": expected_rows,
        "actual_rows": actual_rows,
        "row_coverage": round(actual_rows / expected_rows, 4) if expected_rows else 0.0,
        "warnings": sum(result.status == "warning" for result in results),
        "average_duration_ms": (
            round(sum(result.duration_ms for result in completed) / len(completed), 2)
            if completed
            else None
        ),
        "results": [asdict(result) for result in results],
    }


def write_report(
    results: list[QuoteBenchmarkResult],
    start_date: str,
    end_date: str,
    expected_rows_per_code: int,
    report_dir: Path,
) -> tuple[Path, Path]:
    report_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    summary = build_summary(results, start_date, end_date, expected_rows_per_code)
    json_path = report_dir / f"provider-recovery-benchmark-{stamp}.json"
    markdown_path = report_dir / f"provider-recovery-benchmark-{stamp}.md"
    json_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [
        "# Provider Recovery Benchmark",
        "",
        f"Interval: {start_date} through {end_date}",
        "",
        "| Metric | Value |",
        "| --- | ---: |",
        f"| Sample size | {summary['sample_size']} |",
        f"| Completed | {summary['completed']} |",
        f"| Code coverage | {summary['code_coverage']:.2%} |",
        f"| Full-coverage codes | {summary['full_coverage_codes']} |",
        f"| Row coverage | {summary['row_coverage']:.2%} |",
        f"| Warnings | {summary['warnings']} |",
        f"| Average request duration | {summary['average_duration_ms']} ms |",
    ]
    markdown_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return json_path, markdown_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Benchmark real quote recovery over recent trade dates."
    )
    parser.add_argument("--sample-size", type=int, default=100)
    parser.add_argument("--days", type=int, default=20)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument(
        "--checkpoint-path",
        type=Path,
        default=Path("reports/benchmark-checkpoint.json"),
    )
    parser.add_argument("--report-dir", type=Path, default=Path("reports"))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    provider = AkShareProvider()
    end_date = date.today() - timedelta(days=1)
    start_date, end_date_string = recent_trade_date_range(
        provider.get_trade_calendar(), args.days, end_date
    )
    codes = select_diverse_codes(provider.get_stock_list(), args.sample_size)
    results = benchmark_quotes(
        provider,
        codes,
        start_date,
        end_date_string,
        args.days,
        args.workers,
        args.checkpoint_path,
    )
    json_path, markdown_path = write_report(
        results,
        start_date,
        end_date_string,
        args.days,
        args.report_dir,
    )
    failed = sum(result.status == "failed" for result in results)
    print(json.dumps({"completed": len(results), "failed": failed}))
    print(f"JSON report: {json_path}")
    print(f"Markdown report: {markdown_path}")
    return 0 if all(result.status != "failed" for result in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
