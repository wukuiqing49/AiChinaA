from __future__ import annotations

import argparse
import json
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pandas as pd

from pipeline.providers.akshare_provider import AkShareProvider

REPRESENTATIVE_CODES = (
    "000001",  # 深市主板
    "000002",
    "600000",  # 沪市主板
    "600519",
    "300750",  # 创业板
    "300059",
    "688981",  # 科创板
    "688111",
    "920000",  # 当前北交所代码
    "920001",
    "920002",
    "920008",
    "002594",
    "002415",
    "000858",
    "000333",
    "000651",
    "000725",
    "000938",
    "002230",
    "002475",
    "600150",
    "300014",
    "300124",
    "300308",
    "600036",
    "600276",
    "601318",
    "601398",
    "603259",
)


@dataclass
class ProbeResult:
    name: str
    status: str
    duration_ms: int
    row_count: int | None = None
    columns: list[str] | None = None
    source: str | None = None
    warning: str | None = None
    error: str | None = None


def run_probe(
    provider: AkShareProvider,
    sample_codes: tuple[str, ...],
    start_date: str,
    end_date: str,
    adjust: str,
    data_dir: Path,
) -> tuple[list[ProbeResult], dict[str, pd.DataFrame]]:
    results: list[ProbeResult] = []
    quote_samples: dict[str, pd.DataFrame] = {}

    checks: tuple[tuple[str, Callable[[], pd.DataFrame]], ...] = (
        ("trade_calendar", provider.get_trade_calendar),
        ("stock_list", provider.get_stock_list),
        ("index_quotes_hs300", lambda: provider.get_index_quotes("sh000300")),
        ("financial_reports_000001", lambda: provider.get_financial_reports("000001", "2020")),
        ("industry_list", provider.get_industries),
        ("concept_list", provider.get_concepts),
        ("industry_fund_flow", provider.get_industry_fund_flow),
    )
    for name, operation in checks:
        warning_check = _financial_asof_warning if name.startswith("financial_reports_") else None
        results.append(_probe_dataframe(name, operation, warning_check))

    for code in sample_codes:
        result, normalized = _probe_quote(provider, code, start_date, end_date, adjust)
        results.append(result)
        if normalized is not None:
            quote_samples[code] = normalized
            _write_quote_sample(normalized, data_dir / "quotes" / f"{code}.parquet")

    return results, quote_samples


def _probe_dataframe(
    name: str,
    operation: Callable[[], pd.DataFrame],
    warning_check: Callable[[pd.DataFrame], str | None] | None = None,
) -> ProbeResult:
    started = time.perf_counter()
    try:
        frame = operation()
    except Exception as error:  # Provider errors are report data, not fatal probe failures.
        return ProbeResult(
            name=name,
            status="failed",
            duration_ms=_elapsed_ms(started),
            error=f"{type(error).__name__}: {error}",
        )

    warning = warning_check(frame) if warning_check is not None and not frame.empty else None
    status = "empty" if frame.empty else "warning" if warning else "passed"
    return ProbeResult(
        name=name,
        status=status,
        duration_ms=_elapsed_ms(started),
        row_count=len(frame.index),
        columns=[str(column) for column in frame.columns],
        source=frame.attrs.get("source"),
        warning=warning,
    )


def _financial_asof_warning(frame: pd.DataFrame) -> str | None:
    announcement_columns = {
        "announcement_date",
        "announce_date",
        "NOTICE_DATE",
        "公告日期",
        "公告日",
        "披露日期",
    }
    if announcement_columns.isdisjoint(str(column) for column in frame.columns):
        return (
            "No announcement date column returned; historical fundamental scoring must remain "
            "disabled to prevent future-data leakage."
        )
    return None


def _probe_quote(
    provider: AkShareProvider,
    code: str,
    start_date: str,
    end_date: str,
    adjust: str,
) -> tuple[ProbeResult, pd.DataFrame | None]:
    started = time.perf_counter()
    name = f"daily_quotes_{code}"
    try:
        compact_start_date = start_date.replace("-", "")
        compact_end_date = end_date.replace("-", "")
        raw = provider.get_daily_quotes(code, compact_start_date, compact_end_date, adjust=adjust)
        normalized = provider.normalize_daily_quotes(raw, code)
    except Exception as error:  # Provider errors must be visible in the generated report.
        return (
            ProbeResult(
                name=name,
                status="failed",
                duration_ms=_elapsed_ms(started),
                error=f"{type(error).__name__}: {error}",
            ),
            None,
        )

    if normalized.empty:
        return (
            ProbeResult(
                name=name,
                status="empty",
                duration_ms=_elapsed_ms(started),
            row_count=0,
            columns=list(normalized.columns),
            source=normalized.attrs.get("source"),
                warning="No rows returned for the requested interval.",
            ),
            normalized,
        )

    warning = _quote_warning(normalized)
    return (
        ProbeResult(
            name=name,
            status="passed" if warning is None else "warning",
            duration_ms=_elapsed_ms(started),
            row_count=len(normalized.index),
            columns=list(normalized.columns),
            source=normalized.attrs.get("source"),
            warning=warning,
        ),
        normalized,
    )


def _quote_warning(frame: pd.DataFrame) -> str | None:
    invalid_price_rows = frame[(frame["low"] > frame["high"]) | (frame["close"] <= 0)]
    if not invalid_price_rows.empty:
        return f"{len(invalid_price_rows.index)} rows have invalid OHLC values."
    if frame["trade_date"].duplicated().any():
        return "Duplicate trade_date values returned."
    return None


def _write_quote_sample(frame: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    frame.to_parquet(path, compression="zstd", index=False)


def _elapsed_ms(started: float) -> int:
    return round((time.perf_counter() - started) * 1000)


def build_report(
    results: list[ProbeResult],
    quote_samples: dict[str, pd.DataFrame],
    start_date: str,
    end_date: str,
    universe_size: int,
) -> dict[str, object]:
    completed = [item for item in results if item.status in {"passed", "warning"}]
    quote_results = [item for item in results if item.name.startswith("daily_quotes_")]
    quote_passed = [item for item in quote_results if item.status in {"passed", "warning"}]
    coverage = len(quote_passed) / len(quote_results) if quote_results else 0.0
    sample_rows = sum(len(frame.index) for frame in quote_samples.values())
    average_quote_duration_ms = (
        round(sum(item.duration_ms for item in quote_passed) / len(quote_passed), 2)
        if quote_passed
        else None
    )
    estimated_sequential_seconds = (
        round(average_quote_duration_ms * universe_size / 1000, 2)
        if average_quote_duration_ms is not None
        else None
    )

    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "provider": "akshare",
        "requested_interval": {"start_date": start_date, "end_date": end_date},
        "summary": {
            "checks": len(results),
            "completed_checks": len(completed),
            "quote_coverage": round(coverage, 4),
            "quote_samples": len(quote_samples),
            "quote_rows": sample_rows,
            "average_quote_duration_ms": average_quote_duration_ms,
            "estimated_universe_sequential_seconds": estimated_sequential_seconds,
            "estimated_universe_parallel_4_seconds": (
                round(estimated_sequential_seconds / 4, 2)
                if estimated_sequential_seconds is not None
                else None
            ),
        },
        "results": [asdict(item) for item in results],
    }


def write_report(report: dict[str, object], report_dir: Path) -> tuple[Path, Path]:
    report_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    json_path = report_dir / f"provider-capability-{stamp}.json"
    markdown_path = report_dir / f"provider-capability-{stamp}.md"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    results = report["results"]
    assert isinstance(results, list)
    lines = [
        "# AKShare Provider Capability Report",
        "",
        f"Generated: {report['generated_at']}",
        f"Interval: {report['requested_interval']}",
        "",
        "| Check | Source | Status | Rows | Duration ms | Notes |",
        "| --- | --- | --- | ---: | ---: | --- |",
    ]
    for item in results:
        assert isinstance(item, dict)
        note = item.get("error") or item.get("warning") or ""
        note = str(note).replace("|", "\\|")
        lines.append(
            "| {name} | {source} | {status} | {rows} | {duration} | {note} |".format(
                name=item["name"],
                source=item.get("source") or "-",
                status=item["status"],
                rows=item.get("row_count") if item.get("row_count") is not None else "-",
                duration=item["duration_ms"],
                note=note,
            )
        )
    markdown_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return json_path, markdown_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Probe AKShare capabilities with real data.")
    parser.add_argument(
        "--sample-size",
        type=int,
        default=30,
        choices=range(1, len(REPRESENTATIVE_CODES) + 1),
    )
    parser.add_argument("--start-date", help="YYYY-MM-DD; defaults to 45 days before yesterday.")
    parser.add_argument("--end-date", help="YYYY-MM-DD; defaults to yesterday.")
    parser.add_argument("--adjust", choices=("", "qfq"), default="")
    parser.add_argument("--data-dir", type=Path, default=Path("data/staging/provider-probe"))
    parser.add_argument("--report-dir", type=Path, default=Path("reports"))
    parser.add_argument("--universe-size", type=int, default=5500)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    yesterday = date.today() - timedelta(days=1)
    start_date = args.start_date or (yesterday - timedelta(days=45)).isoformat()
    end_date = args.end_date or yesterday.isoformat()
    provider = AkShareProvider()
    results, quote_samples = run_probe(
        provider=provider,
        sample_codes=REPRESENTATIVE_CODES[: args.sample_size],
        start_date=start_date,
        end_date=end_date,
        adjust=args.adjust,
        data_dir=args.data_dir,
    )
    report = build_report(results, quote_samples, start_date, end_date, args.universe_size)
    json_path, markdown_path = write_report(report, args.report_dir)
    print(json.dumps(report["summary"], ensure_ascii=False))
    print(f"JSON report: {json_path}")
    print(f"Markdown report: {markdown_path}")

    failed = [item for item in results if item.status == "failed"]
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
