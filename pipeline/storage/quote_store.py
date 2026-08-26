from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd

QUOTE_COLUMNS = (
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
)


@dataclass(frozen=True)
class IngestResult:
    accepted_rows: int
    quarantined_rows: int


class QuoteStore:
    def __init__(self, path: Path) -> None:
        self.path = path

    def initialize(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS daily_quotes (
                    code TEXT NOT NULL,
                    trade_date TEXT NOT NULL,
                    open REAL NOT NULL,
                    high REAL NOT NULL,
                    low REAL NOT NULL,
                    close REAL NOT NULL,
                    volume REAL,
                    amount REAL,
                    pct_change REAL,
                    turnover_rate REAL,
                    price_adjustment TEXT NOT NULL,
                    source TEXT NOT NULL,
                    fetched_at TEXT NOT NULL,
                    PRIMARY KEY (code, trade_date, price_adjustment)
                ) WITHOUT ROWID;
                CREATE INDEX IF NOT EXISTS idx_daily_quotes_trade_date
                    ON daily_quotes (trade_date, code);
                CREATE TABLE IF NOT EXISTS quote_quarantine (
                    code TEXT,
                    trade_date TEXT,
                    reason TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    source TEXT NOT NULL,
                    price_adjustment TEXT NOT NULL,
                    quarantined_at TEXT NOT NULL
                );
                """
            )

    def ingest(
        self,
        quotes: pd.DataFrame,
        *,
        source: str,
        price_adjustment: str,
        fetched_at: str | None = None,
    ) -> IngestResult:
        missing = sorted(set(QUOTE_COLUMNS).difference(quotes.columns))
        if missing:
            raise ValueError(f"quote data missing columns: {', '.join(missing)}")
        if not source:
            raise ValueError("source is required")
        if not price_adjustment:
            raise ValueError("price_adjustment is required")

        accepted, rejected = split_valid_quotes(quotes)
        timestamp = fetched_at or datetime.now(UTC).isoformat()
        with self._connect() as connection:
            connection.executemany(
                """
                INSERT INTO daily_quotes (
                    code, trade_date, open, high, low, close, volume, amount,
                    pct_change, turnover_rate, price_adjustment, source, fetched_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(code, trade_date, price_adjustment) DO UPDATE SET
                    open = excluded.open,
                    high = excluded.high,
                    low = excluded.low,
                    close = excluded.close,
                    volume = excluded.volume,
                    amount = excluded.amount,
                    pct_change = excluded.pct_change,
                    turnover_rate = excluded.turnover_rate,
                    source = excluded.source,
                    fetched_at = excluded.fetched_at
                """,
                [
                    (*_sqlite_row(row), price_adjustment, source, timestamp)
                    for row in accepted.loc[:, QUOTE_COLUMNS].itertuples(index=False, name=None)
                ],
            )
            connection.executemany(
                """
                INSERT INTO quote_quarantine (
                    code, trade_date, reason, payload_json, source, price_adjustment, quarantined_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        row["code"],
                        row["trade_date"],
                        row["quarantine_reason"],
                        row.drop(labels="quarantine_reason").to_json(force_ascii=False),
                        source,
                        price_adjustment,
                        timestamp,
                    )
                    for _, row in rejected.iterrows()
                ],
            )
        return IngestResult(accepted_rows=len(accepted.index), quarantined_rows=len(rejected.index))

    def quote_count(self) -> int:
        with self._connect() as connection:
            return int(connection.execute("SELECT COUNT(*) FROM daily_quotes").fetchone()[0])

    def quarantine_count(self) -> int:
        with self._connect() as connection:
            return int(connection.execute("SELECT COUNT(*) FROM quote_quarantine").fetchone()[0])

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path)


def split_valid_quotes(quotes: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    frame = quotes.loc[:, QUOTE_COLUMNS].copy()
    numeric_columns = [column for column in QUOTE_COLUMNS if column not in {"code", "trade_date"}]
    for column in numeric_columns:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    price_columns = ["open", "high", "low", "close"]
    invalid = frame[price_columns].isna().any(axis=1)
    invalid |= (frame[price_columns] <= 0).any(axis=1)
    invalid |= frame["low"] > frame["high"]
    invalid |= frame.duplicated(["code", "trade_date"], keep="last")
    rejected = frame.loc[invalid].copy()
    rejected["quarantine_reason"] = "invalid_ohlc_or_duplicate"
    return frame.loc[~invalid].copy(), rejected


def _sqlite_row(row: tuple[object, ...]) -> tuple[object, ...]:
    return tuple(None if pd.isna(value) else value for value in row)
