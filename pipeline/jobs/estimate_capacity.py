from __future__ import annotations

import argparse
import gzip
import json
import sqlite3
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

import pandas as pd


@dataclass(frozen=True)
class CapacityEstimate:
    sample_files: int
    sample_rows: int
    sample_codes: int
    gzip_json_bytes: int
    sqlite_bytes: int
    expected_rows: int
    r2_quotes_estimate_bytes: int
    sqlite_quotes_estimate_bytes: int
    assumptions: dict[str, int]

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def read_quote_samples(sample_dir: Path) -> pd.DataFrame:
    files = sorted(sample_dir.glob("*.parquet"))
    if not files:
        raise FileNotFoundError(f"No Parquet quote samples found in {sample_dir}")
    return pd.concat((pd.read_parquet(path) for path in files), ignore_index=True)


def estimate_quote_capacity(
    frame: pd.DataFrame,
    sqlite_path: Path,
    universe_size: int,
    trading_days_per_year: int,
    years: int,
) -> CapacityEstimate:
    required_columns = [
        "code",
        "trade_date",
        "open",
        "high",
        "low",
        "close",
        "volume",
        "amount",
        "pct_change",
        "turnover_rate",
    ]
    missing = sorted(set(required_columns).difference(frame.columns))
    if missing:
        raise ValueError(f"Quote sample missing columns: {', '.join(missing)}")

    normalized = frame.loc[:, required_columns].drop_duplicates(["code", "trade_date"]).copy()
    gzip_json_bytes = _gzip_json_bytes(normalized)
    sqlite_bytes = _write_sqlite_sample(normalized, sqlite_path)
    sample_rows = len(normalized.index)
    expected_rows = universe_size * trading_days_per_year * years

    return CapacityEstimate(
        sample_files=normalized["code"].nunique(),
        sample_rows=sample_rows,
        sample_codes=normalized["code"].nunique(),
        gzip_json_bytes=gzip_json_bytes,
        sqlite_bytes=sqlite_bytes,
        expected_rows=expected_rows,
        r2_quotes_estimate_bytes=round(gzip_json_bytes / sample_rows * expected_rows),
        sqlite_quotes_estimate_bytes=round(sqlite_bytes / sample_rows * expected_rows),
        assumptions={
            "universe_size": universe_size,
            "trading_days_per_year": trading_days_per_year,
            "years": years,
        },
    )


def _gzip_json_bytes(frame: pd.DataFrame) -> int:
    payload = frame.to_json(orient="records", force_ascii=False, date_format="iso")
    return len(gzip.compress(payload.encode("utf-8"), compresslevel=9))


def _write_sqlite_sample(frame: pd.DataFrame, sqlite_path: Path) -> int:
    sqlite_path.parent.mkdir(parents=True, exist_ok=True)
    if sqlite_path.exists():
        sqlite_path.unlink()

    with sqlite3.connect(sqlite_path) as connection:
        connection.executescript(
            """
            CREATE TABLE daily_quotes (
                trade_date TEXT NOT NULL,
                code TEXT NOT NULL,
                open REAL,
                high REAL,
                low REAL,
                close REAL,
                volume REAL,
                amount REAL,
                pct_change REAL,
                turnover_rate REAL,
                PRIMARY KEY (trade_date, code)
            ) WITHOUT ROWID;
            CREATE INDEX idx_daily_quotes_code_date ON daily_quotes (code, trade_date);
            """
        )
        values = [
            tuple(None if pd.isna(value) else value for value in row)
            for row in frame.itertuples(index=False, name=None)
        ]
        connection.executemany(
            """
            INSERT INTO daily_quotes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            values,
        )
        connection.commit()
        connection.execute("VACUUM")
    return sqlite_path.stat().st_size


def write_report(estimate: CapacityEstimate, report_dir: Path) -> tuple[Path, Path]:
    report_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    json_path = report_dir / f"capacity-estimate-{stamp}.json"
    markdown_path = report_dir / f"capacity-estimate-{stamp}.md"
    payload = estimate.to_dict()
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# Ten-Year Quote Capacity Estimate",
        "",
        (
            "This estimate covers normalized daily quote history only. It does not claim to "
            "include valuation, score, financial, sector, signal, manifest, or backup storage."
        ),
        "",
        "| Metric | Value |",
        "| --- | ---: |",
        f"| Sample quote rows | {estimate.sample_rows:,} |",
        f"| Sample codes | {estimate.sample_codes:,} |",
        f"| Expected rows | {estimate.expected_rows:,} |",
        f"| R2 gzip JSON estimate | {_format_bytes(estimate.r2_quotes_estimate_bytes)} |",
        f"| SQLite plus index estimate | {_format_bytes(estimate.sqlite_quotes_estimate_bytes)} |",
        "",
        (
            "The final R2 Gate remains pending until valuation and score output are measured "
            "with real data."
        ),
    ]
    markdown_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return json_path, markdown_path


def _format_bytes(value: int) -> str:
    return f"{value / 1024 / 1024 / 1024:.2f} GiB"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Estimate ten-year quote storage from real Parquet samples."
    )
    parser.add_argument(
        "--sample-dir",
        type=Path,
        default=Path("data/staging/provider-probe/quotes"),
    )
    parser.add_argument(
        "--sqlite-path",
        type=Path,
        default=Path("data/staging/capacity/quotes.sqlite"),
    )
    parser.add_argument("--report-dir", type=Path, default=Path("reports"))
    parser.add_argument("--universe-size", type=int, default=5500)
    parser.add_argument("--trading-days-per-year", type=int, default=244)
    parser.add_argument("--years", type=int, default=10)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    samples = read_quote_samples(args.sample_dir)
    estimate = estimate_quote_capacity(
        frame=samples,
        sqlite_path=args.sqlite_path,
        universe_size=args.universe_size,
        trading_days_per_year=args.trading_days_per_year,
        years=args.years,
    )
    json_path, markdown_path = write_report(estimate, args.report_dir)
    print(json.dumps(estimate.to_dict(), ensure_ascii=False))
    print(f"JSON report: {json_path}")
    print(f"Markdown report: {markdown_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
