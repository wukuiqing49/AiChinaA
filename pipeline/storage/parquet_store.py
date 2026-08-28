from __future__ import annotations

from pathlib import Path

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq


def save_quotes(frame: pd.DataFrame, file_path: Path) -> None:
    """Save normalized quotes dataframe to a single Parquet file with Snappy compression."""
    if frame.empty:
        return
    file_path.parent.mkdir(parents=True, exist_ok=True)
    table = pa.Table.from_pandas(frame, preserve_index=False)
    pq.write_table(table, file_path, compression="snappy")


def append_or_update_quotes(
    new_frame: pd.DataFrame, file_path: Path, primary_keys: tuple[str, ...] = ("trade_date",)
) -> pd.DataFrame:
    """Merge new quote rows into an existing Parquet file, deduplicating on primary keys."""
    if not file_path.exists():
        save_quotes(new_frame, file_path)
        return new_frame

    existing = load_quotes_file(file_path)
    combined = pd.concat([existing, new_frame], ignore_index=True)
    combined = combined.drop_duplicates(subset=list(primary_keys), keep="last")
    combined = combined.sort_values(list(primary_keys)).reset_index(drop=True)
    save_quotes(combined, file_path)
    return combined


def load_quotes_file(
    file_path: Path,
    *,
    start_date: str | None = None,
    end_date: str | None = None,
) -> pd.DataFrame:
    """Load quotes from a single Parquet file, optionally filtered by date range."""
    if not file_path.exists():
        return pd.DataFrame()

    table = pq.read_table(file_path)
    frame = table.to_pandas()
    if frame.empty or "trade_date" not in frame.columns:
        return frame

    if start_date:
        frame = frame.loc[frame["trade_date"] >= start_date]
    if end_date:
        frame = frame.loc[frame["trade_date"] <= end_date]
    return frame.sort_values("trade_date").reset_index(drop=True)


def list_saved_codes(data_dir: Path) -> list[str]:
    """Return all codes that have saved parquet files in the directory."""
    if not data_dir.exists():
        return []
    return sorted([p.stem for p in data_dir.glob("*.parquet")])
