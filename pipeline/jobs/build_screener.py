from __future__ import annotations

import argparse
import json
import math
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pandas as pd

from pipeline.calculations.technical import calculate_technical_factors, score_technical_factors
from pipeline.providers.akshare_provider import AkShareProvider
from pipeline.storage.parquet_store import load_quotes_file
from pipeline.universe import CORE_INDICES, classify_instrument, filter_universe

FALLBACK_CODES = (
    "000001", "000002", "000333", "000651", "000858", "000938", "002230", "002415",
    "002475", "002594", "600000", "600036", "600150", "600276", "600519", "601318",
    "601398", "603259", "510050", "510300", "510500", "159915", "159919",
)


def _column(frame: pd.DataFrame, names: tuple[str, ...]) -> str | None:
    return next((name for name in names if name in frame.columns), None)


def _normalize_codes(stock_list: pd.DataFrame) -> pd.DataFrame:
    code_column = _column(stock_list, ("代码", "code", "symbol"))
    if code_column is None:
        raise ValueError("stock list is missing a code column")
    output = pd.DataFrame({"code": stock_list[code_column].astype(str).str.zfill(6)})
    name_column = _column(stock_list, ("名称", "name", "简称"))
    output["name"] = stock_list[name_column].astype(str) if name_column else output["code"]
    for target, names in {
        "close": ("最新价", "close", "收盘"),
        "pct_change": ("涨跌幅", "pct_change"),
        "turnover_rate": ("换手率", "turnover_rate"),
    }.items():
        source = _column(stock_list, names)
        output[target] = pd.to_numeric(stock_list[source], errors="coerce") if source else None
    output = output[output["code"].str.match(r"^\d{6}$")]
    output = filter_universe(output, allow_stocks=True, allow_etfs=True, exclude_st=True)
    output["instrument_type"] = output.apply(
        lambda row: classify_instrument(row["code"], row["name"]), axis=1
    )
    return output.drop_duplicates("code").reset_index(drop=True)


def _fallback_metadata(max_stocks: int) -> pd.DataFrame:
    codes = list(FALLBACK_CODES if max_stocks <= 0 else FALLBACK_CODES[:max_stocks])
    output = pd.DataFrame(
        {
            "code": codes,
            "name": codes,
            "close": [None] * len(codes),
            "pct_change": [None] * len(codes),
            "turnover_rate": [None] * len(codes),
        }
    )
    output["instrument_type"] = output["code"].map(classify_instrument)
    return output


class LocalHistoryProvider:
    """Adapter that lets the screener reuse downloaded Parquet history."""

    def __init__(self, data_dir: Path) -> None:
        self._paths: dict[str, Path] = {}
        self._names = self._load_names(data_dir / "checkpoints.json")
        for folder in ("stocks", "etfs"):
            for quote_file in (data_dir / folder).glob("*.parquet"):
                self._paths[quote_file.stem] = quote_file

    @staticmethod
    def _load_names(checkpoint_file: Path) -> dict[str, str]:
        try:
            payload = json.loads(checkpoint_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        if not isinstance(payload, dict):
            return {}
        return {
            str(code): str(item.get("name") or code)
            for code, item in payload.items()
            if isinstance(item, dict)
        }

    def get_stock_list(self) -> pd.DataFrame:
        codes = sorted(self._paths)
        return pd.DataFrame(
            {
                "code": codes,
                "name": [self._names.get(code, code) for code in codes],
            }
        )

    def get_daily_quotes(
        self, code: str, start_date: str, end_date: str, adjust: str
    ) -> pd.DataFrame:
        quote_file = self._paths.get(str(code).zfill(6))
        if quote_file is None:
            return pd.DataFrame()
        return load_quotes_file(
            quote_file,
            start_date=f"{start_date[:4]}-{start_date[4:6]}-{start_date[6:]}",
            end_date=f"{end_date[:4]}-{end_date[4:6]}-{end_date[6:]}",
        )

    def normalize_daily_quotes(self, frame: pd.DataFrame, code: str) -> pd.DataFrame:
        return frame


def _build_index_payload(data_dir: Path) -> list[dict[str, object]]:
    names = {item["code"]: item["name"] for item in CORE_INDICES}
    frames = [
        load_quotes_file(quote_file)
        for quote_file in sorted((data_dir / "indices").glob("*.parquet"))
    ]
    frames = [frame for frame in frames if not frame.empty and len(frame) >= 20]
    if not frames:
        return []

    quotes = pd.concat(frames, ignore_index=True)
    factors = calculate_technical_factors(quotes, price_adjustment="qfq")
    latest = factors.sort_values("trade_date").groupby("code", as_index=False).tail(1)
    quote_latest = quotes.sort_values("trade_date").groupby("code", as_index=False).tail(1)
    quote_columns = [
        column
        for column in ("code", "trade_date", "close", "pct_change")
        if column in quote_latest
    ]
    latest = latest.merge(
        quote_latest[quote_columns],
        on=["code", "trade_date"],
        how="left",
        suffixes=("", "_quote"),
    )
    output = []
    for item in latest.sort_values("code").to_dict(orient="records"):
        code = str(item["code"])
        output.append(
            {
                "code": code,
                "name": names.get(code, code),
                "tradeDate": str(item["trade_date"]),
                "quoteDate": None,
                "quoteTime": None,
                "quoteSource": None,
                "close": _json_value(item.get("close_quote", item.get("close"))),
                "pctChange": _json_value(item.get("pct_change_quote", item.get("pct_change"))),
                "ret20d": _json_value(item.get("ret_20d")),
                "ma20Slope": _json_value(item.get("ma20_slope")),
                "volatility20": _json_value(item.get("volatility_20")),
            }
        )
    return output


def _market(code: str) -> str:
    if code.startswith("6"):
        return "SH"
    if code.startswith(("4", "8", "9")):
        return "BJ"
    return "SZ"


def _fetch_one(
    provider: AkShareProvider, code: str, start_date: str, end_date: str
) -> pd.DataFrame:
    raw = provider.get_daily_quotes(
        code, start_date.replace("-", ""), end_date.replace("-", ""), adjust="qfq"
    )
    return provider.normalize_daily_quotes(raw, code)


def build_payload(
    provider: AkShareProvider,
    *,
    start_date: str,
    end_date: str,
    max_stocks: int,
    workers: int,
) -> tuple[dict[str, object], list[str]]:
    try:
        metadata = _normalize_codes(provider.get_stock_list())
    except RuntimeError as error:
        print(f"stock list unavailable; using fallback universe: {error}")
        metadata = _fallback_metadata(max_stocks)
    if max_stocks > 0:
        metadata = metadata.head(max_stocks)
    if metadata.empty:
        raise ValueError("stock list contains no supported A-share codes")

    frames: list[pd.DataFrame] = []
    failures: list[str] = []
    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        futures = {
            executor.submit(_fetch_one, provider, code, start_date, end_date): code
            for code in metadata["code"]
        }
        for future in as_completed(futures):
            code = futures[future]
            try:
                frame = future.result()
                if len(frame) >= 20:
                    frames.append(frame)
                else:
                    failures.append(f"{code}: only {len(frame)} quote rows")
            except Exception as error:
                failures.append(f"{code}: {type(error).__name__}: {error}")

    if not frames:
        raise RuntimeError("no stock history could be fetched; " + " | ".join(failures[:5]))

    quotes = pd.concat(frames, ignore_index=True)
    factors = calculate_technical_factors(quotes, price_adjustment="qfq")
    scores = score_technical_factors(factors)
    latest = factors.sort_values("trade_date").groupby("code", as_index=False).tail(1)
    latest_scores = scores.sort_values("trade_date").groupby("code", as_index=False).tail(1)
    result = latest.merge(
        latest_scores, on=["code", "trade_date"], how="left", suffixes=("", "_score")
    )
    result = result.merge(metadata, on="code", how="left", suffixes=("", "_meta"))
    quote_columns = ["code", "close"]
    for column in ("pct_change", "turnover_rate"):
        if column in quotes.columns:
            quote_columns.append(column)
    quote_latest = quotes.sort_values("trade_date").groupby("code", as_index=False).tail(1)
    result = result.merge(
        quote_latest[quote_columns], on="code", how="left", suffixes=("", "_quote")
    )
    trade_date = str(result["trade_date"].max())

    rows: list[dict[str, object]] = []
    for item in result.to_dict(orient="records"):
        code = str(item["code"]).zfill(6)
        row = {
            "code": code,
            "name": str(item.get("name") or code),
            "instrumentType": str(item.get("instrument_type") or classify_instrument(code)),
            "tradeDate": str(item["trade_date"]),
            "quoteDate": None,
            "quoteTime": None,
            "quoteSource": None,
            "close": (
                item.get("close_quote")
                if item.get("close_quote") is not None
                else item.get("close")
            ),
            "scoreTotal": item.get("score_total"),
            "dataCompleteness": item.get("data_completeness"),
            "market": _market(code),
            "industry": "",
            "pctChange": (
                item.get("pct_change_quote")
                if item.get("pct_change_quote") is not None
                else item.get("pct_change")
            ),
            "turnoverRate": (
                item.get("turnover_rate_quote")
                if item.get("turnover_rate_quote") is not None
                else item.get("turnover_rate")
            ),
            "ret5d": item.get("ret_5d"),
            "ret20d": item.get("ret_20d"),
            "ret60d": item.get("ret_60d"),
            "ma20Slope": item.get("ma20_slope"),
            "volumeRatio20": item.get("volume_ratio_20"),
            "volatility20": item.get("volatility_20"),
        }
        rows.append({key: _json_value(value) for key, value in row.items()})

    payload = {
        "runId": f"screener-{trade_date}-{int(time.time())}",
        "tradeDate": trade_date,
        "stocks": rows,
        "indices": [],
    }
    return payload, failures


def _json_value(value: object) -> object:
    if value is None:
        return None
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    if hasattr(value, "item"):
        return _json_value(value.item())
    return value


def _usable_quote_name(value: object, code: str) -> bool:
    return (
        isinstance(value, str)
        and bool(value.strip())
        and value.strip() != code
        and "�" not in value
    )


def _normalize_quote_name(value: object) -> str:
    return unicodedata.normalize("NFKC", "".join(str(value).split()))


def _apply_realtime_quotes(
    payload: dict[str, object], quote_file: Path, *, now: datetime | None = None
) -> None:
    try:
        snapshot = json.loads(quote_file.read_text(encoding="utf-8"))
        generated_at = datetime.fromisoformat(snapshot["generatedAt"].replace("Z", "+00:00"))
        quotes = snapshot.get("quotes", {})
    except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError):
        return
    current = now or datetime.now(UTC)
    if generated_at.tzinfo is None:
        generated_at = generated_at.replace(tzinfo=UTC)
    age = current.astimezone(UTC) - generated_at.astimezone(UTC)
    if age < -timedelta(minutes=5) or age > timedelta(hours=18):
        return

    collections = (
        (payload.get("stocks", []), False),
        (payload.get("indices", []), True),
    )
    for collection, is_index in collections:
        if not isinstance(collection, list):
            continue
        for row in collection:
            if not isinstance(row, dict):
                continue
            kind = "index" if is_index else row.get("instrumentType")
            quote = quotes.get(f"{kind}:{row.get('code')}")
            if (
                not isinstance(quote, dict)
                or quote.get("quoteDate", "") < row.get("tradeDate", "")
            ):
                continue
            row["close"] = quote.get("close")
            row["pctChange"] = quote.get("pctChange")
            if _usable_quote_name(quote.get("name"), str(row.get("code"))):
                row["name"] = _normalize_quote_name(quote["name"])
            row["quoteDate"] = quote.get("quoteDate")
            row["quoteTime"] = quote.get("quoteTime")
            row["quoteSource"] = quote.get("quoteSource")
            if is_index:
                try:
                    history_lag = (
                        date.fromisoformat(str(row["quoteDate"]))
                        - date.fromisoformat(str(row["tradeDate"]))
                    ).days
                except ValueError:
                    history_lag = 0
                if history_lag > 7:
                    for field in ("ret20d", "ma20Slope", "volatility20"):
                        row[field] = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build the JSON package consumed by the screener publisher."
    )
    parser.add_argument("--output", type=Path, default=Path("reports/screener-publish.json"))
    parser.add_argument("--data-dir", type=Path, default=Path("data/historical"))
    parser.add_argument("--start-date", default=(date.today() - timedelta(days=380)).isoformat())
    parser.add_argument("--end-date", default=date.today().isoformat())
    parser.add_argument("--max-stocks", type=int, default=0, help="0 means all saved instruments")
    parser.add_argument("--workers", type=int, default=4)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    provider = (
        LocalHistoryProvider(args.data_dir)
        if (args.data_dir / "stocks").exists()
        else AkShareProvider()
    )
    payload, failures = build_payload(
        provider,
        start_date=args.start_date,
        end_date=args.end_date,
        max_stocks=args.max_stocks,
        workers=args.workers,
    )
    if isinstance(provider, LocalHistoryProvider):
        payload["indices"] = _build_index_payload(args.data_dir)
        _apply_realtime_quotes(payload, args.data_dir.parent / "realtime" / "tencent-quotes.json")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, allow_nan=False), encoding="utf-8"
    )
    print(f"wrote {len(payload['stocks'])} stocks to {args.output}")
    if failures:
        print(f"skipped {len(failures)} stocks")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
