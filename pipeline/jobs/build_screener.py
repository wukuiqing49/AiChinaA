from __future__ import annotations

import argparse
import json
import math
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

from pipeline.calculations.technical import calculate_technical_factors, score_technical_factors
from pipeline.providers.akshare_provider import AkShareProvider

FALLBACK_CODES = (
    "000001", "000002", "000333", "000651", "000858", "000938", "002230", "002415",
    "002475", "002594", "300014", "300059", "300124", "300308", "300750", "600000",
    "600036", "600150", "600276", "600519", "601318", "601398", "603259", "688111",
    "688981", "920000", "920001", "920002", "920008",
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
    return output.drop_duplicates("code").reset_index(drop=True)


def _fallback_metadata(max_stocks: int) -> pd.DataFrame:
    codes = list(FALLBACK_CODES if max_stocks <= 0 else FALLBACK_CODES[:max_stocks])
    return pd.DataFrame(
        {
            "code": codes,
            "name": codes,
            "close": [None] * len(codes),
            "pct_change": [None] * len(codes),
            "turnover_rate": [None] * len(codes),
        }
    )


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
    quote_latest = quotes.sort_values("trade_date").groupby("code", as_index=False).tail(1)
    result = result.merge(
        quote_latest[["code", "close"]], on="code", how="left", suffixes=("", "_quote")
    )
    trade_date = str(result["trade_date"].max())

    rows: list[dict[str, object]] = []
    for item in result.to_dict(orient="records"):
        code = str(item["code"]).zfill(6)
        row = {
            "code": code,
            "name": str(item.get("name") or code),
            "close": (
                item.get("close_quote")
                if item.get("close_quote") is not None
                else item.get("close")
            ),
            "scoreTotal": item.get("score_total"),
            "dataCompleteness": item.get("data_completeness"),
            "market": _market(code),
            "industry": "",
            "pctChange": item.get("pct_change"),
            "turnoverRate": item.get("turnover_rate"),
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build the JSON package consumed by the screener publisher."
    )
    parser.add_argument("--output", type=Path, default=Path("reports/screener-publish.json"))
    parser.add_argument("--start-date", default=(date.today() - timedelta(days=380)).isoformat())
    parser.add_argument("--end-date", default=date.today().isoformat())
    parser.add_argument("--max-stocks", type=int, default=300, help="0 means all listed stocks")
    parser.add_argument("--workers", type=int, default=4)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    payload, failures = build_payload(
        AkShareProvider(),
        start_date=args.start_date,
        end_date=args.end_date,
        max_stocks=args.max_stocks,
        workers=args.workers,
    )
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
