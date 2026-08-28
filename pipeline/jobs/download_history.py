from __future__ import annotations

import argparse
import json
import shutil
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, date, datetime
from pathlib import Path

import pandas as pd

from pipeline.providers.akshare_provider import AkShareProvider
from pipeline.storage.parquet_store import append_or_update_quotes, load_quotes_file
from pipeline.universe import CORE_INDICES, classify_instrument, filter_universe


def _load_checkpoints(checkpoint_file: Path) -> dict[str, dict[str, object]]:
    if not checkpoint_file.exists():
        return {}
    try:
        checkpoints = json.loads(checkpoint_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(
            f"Checkpoint file is invalid: {checkpoint_file}. "
            "Run with --repair-checkpoints before downloading."
        ) from error
    if not isinstance(checkpoints, dict):
        raise RuntimeError(
            f"Checkpoint file must contain a JSON object: {checkpoint_file}. "
            "Run with --repair-checkpoints before downloading."
        )
    return checkpoints


def _save_checkpoints(checkpoints: dict[str, dict[str, object]], checkpoint_file: Path) -> None:
    checkpoint_file.parent.mkdir(parents=True, exist_ok=True)
    temporary_file = checkpoint_file.with_suffix(".json.tmp")
    temporary_file.write_text(
        json.dumps(checkpoints, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    temporary_file.replace(checkpoint_file)


def rebuild_checkpoints_from_saved_files(data_dir: Path) -> dict[str, object]:
    """Recreate checkpoints from saved quote files without requesting any data."""
    checkpoint_file = data_dir / "checkpoints.json"
    backup_file: Path | None = None
    if checkpoint_file.exists():
        backup_stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        backup_file = checkpoint_file.with_name(f"checkpoints.corrupt-{backup_stamp}.json")
        shutil.copy2(checkpoint_file, backup_file)

    checkpoints: dict[str, dict[str, object]] = {}
    invalid_files: list[str] = []
    folders = (("stocks", "stock"), ("etfs", "etf"), ("indices", "index"))
    for folder, instrument_type in folders:
        for quote_file in sorted((data_dir / folder).glob("*.parquet")):
            try:
                frame = load_quotes_file(quote_file)
                if frame.empty or "trade_date" not in frame.columns:
                    invalid_files.append(str(quote_file))
                    continue
                code = quote_file.stem
                checkpoints[code] = {
                    "code": code,
                    "name": code,
                    "type": instrument_type,
                    "status": "success",
                    "rows": len(frame),
                    "min_date": str(frame["trade_date"].min()),
                    "max_date": str(frame["trade_date"].max()),
                    "updated_at": datetime.now(UTC).isoformat(),
                }
            except Exception:
                invalid_files.append(str(quote_file))

    _save_checkpoints(checkpoints, checkpoint_file)
    return {
        "repaired": len(checkpoints),
        "invalid_files": invalid_files,
        "backup_file": str(backup_file) if backup_file else None,
    }


def _fetch_instrument(
    provider: AkShareProvider,
    code: str,
    instrument_type: str,
    start_date: str,
    end_date: str,
) -> tuple[str, str, pd.DataFrame | None, str | None]:
    start_clean = start_date.replace("-", "")
    end_clean = end_date.replace("-", "")
    try:
        if instrument_type == "index":
            raw = provider.get_index_quotes(code)
            if raw.empty:
                return code, instrument_type, None, "empty index data"
            normalized = provider.normalize_daily_quotes(raw, code)
        elif instrument_type == "etf":
            raw = provider.get_etf_quotes(code, start_clean, end_clean, adjust="qfq")
            if raw.empty:
                return code, instrument_type, None, "empty etf data"
            normalized = provider.normalize_daily_quotes(raw, code)
        else:
            raw = provider.get_daily_quotes(code, start_clean, end_clean, adjust="qfq")
            if raw.empty:
                return code, instrument_type, None, "empty stock data"
            normalized = provider.normalize_daily_quotes(raw, code)

        if start_date:
            normalized = normalized.loc[normalized["trade_date"] >= start_date]
        if end_date:
            normalized = normalized.loc[normalized["trade_date"] <= end_date]

        return code, instrument_type, normalized, None
    except Exception as error:
        return code, instrument_type, None, str(error)


def _target_items(
    provider: AkShareProvider,
    *,
    include_stocks: bool,
    include_etfs: bool,
    include_indices: bool,
) -> list[tuple[str, str, str]]:
    target_items: list[tuple[str, str, str]] = []

    if include_indices:
        target_items.extend((idx["code"], idx["name"], "index") for idx in CORE_INDICES)

    if include_stocks:
        try:
            raw_list = provider.get_stock_list()
            code_col = next((c for c in ("代码", "code", "symbol") if c in raw_list.columns), None)
            name_col = next((c for c in ("名称", "name", "简称") if c in raw_list.columns), None)
            if code_col:
                clean_codes = (
                    raw_list[code_col]
                    .astype(str)
                    .str.replace(r"^(sh|sz|bj)", "", regex=True)
                    .str.zfill(6)
                )
                items = pd.DataFrame({"code": clean_codes})
                items["name"] = raw_list[name_col].astype(str) if name_col else items["code"]
                items = filter_universe(
                    items, allow_stocks=True, allow_etfs=False, exclude_st=False
                )
                for _, row in items.iterrows():
                    code = row["code"]
                    name = row["name"]
                    target_items.append((code, name, classify_instrument(code, name)))
        except Exception as error:
            print(f"Warning: Failed to fetch stock list: {error}.")

    if include_etfs:
        try:
            etf_list = provider.get_etf_list()
            items = filter_universe(
                etf_list, allow_stocks=False, allow_etfs=True, exclude_st=False
            )
            target_items.extend((row["code"], row["name"], "etf") for _, row in items.iterrows())
        except Exception as error:
            print(f"Warning: Failed to fetch ETF list: {error}.")

    return target_items


def repair_checkpoint_names(
    provider: AkShareProvider,
    *,
    data_dir: Path,
    include_stocks: bool = True,
    include_etfs: bool = True,
    include_indices: bool = True,
) -> dict[str, object]:
    """Backfill checkpoint names from current instrument lists without downloading bars."""
    checkpoint_file = data_dir / "checkpoints.json"
    checkpoints = _load_checkpoints(checkpoint_file)
    updated = 0
    matched = 0
    for code, name, instrument_type in _target_items(
        provider,
        include_stocks=include_stocks,
        include_etfs=include_etfs,
        include_indices=include_indices,
    ):
        checkpoint = checkpoints.get(code)
        if not checkpoint or not name or name == code:
            continue
        matched += 1
        if checkpoint.get("name") != name or checkpoint.get("type") != instrument_type:
            checkpoint["name"] = name
            checkpoint["type"] = instrument_type
            updated += 1
    _save_checkpoints(checkpoints, checkpoint_file)
    return {"matched": matched, "updated": updated, "total": len(checkpoints)}


def run_download(
    provider: AkShareProvider,
    *,
    data_dir: Path,
    start_date: str,
    end_date: str,
    include_stocks: bool = True,
    include_etfs: bool = True,
    include_indices: bool = True,
    max_items: int = 0,
    workers: int = 4,
    force_refresh: bool = False,
    incremental: bool = False,
) -> dict[str, object]:
    checkpoint_file = data_dir / "checkpoints.json"
    checkpoints = {} if force_refresh else _load_checkpoints(checkpoint_file)

    target_items = _target_items(
        provider,
        include_stocks=include_stocks,
        include_etfs=include_etfs,
        include_indices=include_indices,
    )

    if max_items > 0:
        target_items = target_items[:max_items]

    print(f"Total targets to process: {len(target_items)}")

    # Filter pending items
    pending_items: list[tuple[str, str, str, str]] = []  # (code, name, type, effective_start_date)
    for code, name, inst_type in target_items:
        cp = checkpoints.get(code)
        if incremental and cp and cp.get("status") == "success":
            max_d = str(cp.get("max_date", ""))
            if max_d and max_d < end_date:
                # Need to fetch only from max_d to end_date
                pending_items.append((code, name, inst_type, max_d))
            elif not max_d:
                pending_items.append((code, name, inst_type, start_date))
        elif not incremental:
            if not cp or cp.get("status") != "success":
                pending_items.append((code, name, inst_type, start_date))

    done_count = len(target_items) - len(pending_items)
    print(f"Pending downloads: {len(pending_items)} (already up to date: {done_count})")

    success_count = 0
    failure_count = 0

    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        futures = {
            executor.submit(
                _fetch_instrument, provider, code, inst_type, eff_start, end_date
            ): (code, name, inst_type)
            for code, name, inst_type, eff_start in pending_items
        }

        for future in as_completed(futures):
            code, name, inst_type = futures[future]
            res_code, res_type, frame, err = future.result()
            sub_folder = (
                "stocks" if res_type == "stock" else ("etfs" if res_type == "etf" else "indices")
            )
            target_path = data_dir / sub_folder / f"{res_code}.parquet"

            if err is None and frame is not None and not frame.empty:
                append_or_update_quotes(frame, target_path)
                
                # Check total rows in the parquet file
                try:
                    full_df = load_quotes_file(target_path)
                    total_rows = len(full_df)
                    min_date = str(full_df["trade_date"].min())
                    max_date = str(full_df["trade_date"].max())
                except Exception:
                    total_rows = len(frame)
                    min_date = str(frame["trade_date"].min())
                    max_date = str(frame["trade_date"].max())

                checkpoints[res_code] = {
                    "code": res_code,
                    "name": name,
                    "type": res_type,
                    "status": "success",
                    "rows": total_rows,
                    "min_date": min_date,
                    "max_date": max_date,
                    "updated_at": datetime.now(UTC).isoformat(),
                }
                success_count += 1
                if success_count % 10 == 0 or success_count == len(pending_items):
                    _save_checkpoints(checkpoints, checkpoint_file)
                    print(
                        f"Progress: {success_count}/{len(pending_items)} saved. "
                        f"Latest: {res_code} ({name}) - now has {total_rows} total bars."
                    )
            else:
                if not (incremental and target_path.exists()):
                    checkpoints[res_code] = {
                        "code": res_code,
                        "name": name,
                        "type": res_type,
                        "status": "failed",
                        "error": err or "empty",
                        "updated_at": datetime.now(UTC).isoformat(),
                    }
                failure_count += 1
                print(f"Failed / Skipped: {res_code} ({name}): {err}")

    _save_checkpoints(checkpoints, checkpoint_file)
    return {
        "total": len(target_items),
        "success": success_count,
        "failed": failure_count,
        "data_dir": str(data_dir),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download multi-year historical data for Main Board stocks, ETFs, and Indices."
    )
    parser.add_argument("--data-dir", type=Path, default=Path("data/historical"))
    parser.add_argument("--start-date", default="1990-01-01", help="Default start date")
    parser.add_argument("--end-date", default=date.today().isoformat())
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--max-items", type=int, default=0, help="0 means all targets")
    parser.add_argument("--force", action="store_true", help="Force refresh existing checkpoints")
    parser.add_argument(
        "--repair-checkpoints",
        action="store_true",
        help="Rebuild checkpoints from existing Parquet files and exit",
    )
    parser.add_argument(
        "--repair-names",
        action="store_true",
        help="Backfill checkpoint names from current lists without downloading bars and exit",
    )
    parser.add_argument(
        "--incremental",
        action="store_true",
        help="Incremental daily update mode: only fetch new daily bars since last saved date",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.repair_checkpoints:
        summary = rebuild_checkpoints_from_saved_files(args.data_dir)
        print(f"Checkpoint repair finished: {summary}")
        return 0
    if args.repair_names:
        summary = repair_checkpoint_names(AkShareProvider(), data_dir=args.data_dir)
        print(f"Checkpoint name repair finished: {summary}")
        return 0
    summary = run_download(
        AkShareProvider(),
        data_dir=args.data_dir,
        start_date=args.start_date,
        end_date=args.end_date,
        workers=args.workers,
        max_items=args.max_items,
        force_refresh=args.force,
        incremental=args.incremental,
    )
    print(f"\nDownload finished: {summary}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
