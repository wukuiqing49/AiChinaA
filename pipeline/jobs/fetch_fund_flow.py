from __future__ import annotations

import argparse
import json
from datetime import date, datetime
from pathlib import Path

import pandas as pd

from pipeline.providers.akshare_provider import AkShareProvider


def _number(value: object) -> float | None:
    number = pd.to_numeric(value, errors="coerce")
    return None if pd.isna(number) else float(number)


def _column(frame: pd.DataFrame, name: str) -> pd.Series:
    return frame[name] if name in frame.columns else pd.Series([None] * len(frame), index=frame.index)


def _normalize(frame: pd.DataFrame, indicator: str) -> pd.DataFrame:
    prefix = "今日" if indicator == "今日" else indicator
    code = _column(frame, "代码").astype(str).str.strip().str.zfill(6)
    output = pd.DataFrame({"code": code})
    output[f"mainNetInflow{'' if indicator == '今日' else indicator}"] = _column(frame, f"{prefix}主力净流入-净额").map(_number)
    if indicator == "今日":
        output["mainNetInflowPct"] = _column(frame, "今日主力净流入-净占比").map(_number)
        output["superLargeNetInflow"] = _column(frame, "今日超大单净流入-净额").map(_number)
        output["largeNetInflow"] = _column(frame, "今日大单净流入-净额").map(_number)
        output["mediumNetInflow"] = _column(frame, "今日中单净流入-净额").map(_number)
        output["smallNetInflow"] = _column(frame, "今日小单净流入-净额").map(_number)
    return output[output["code"].str.fullmatch(r"\d{6}")].drop_duplicates("code")


def fetch_payload(provider: AkShareProvider, data_date: str | None = None) -> dict[str, object]:
    frames = [_normalize(provider.get_individual_fund_flow_rank(window), window) for window in ("今日", "3日", "5日", "10日")]
    merged = frames[0]
    for frame in frames[1:]:
        merged = merged.merge(frame, on="code", how="outer")
    rows = []
    for row in merged.to_dict(orient="records"):
        rows.append({
            "code": row["code"], "mainNetInflow": row.get("mainNetInflow"), "mainNetInflowPct": row.get("mainNetInflowPct"),
            "superLargeNetInflow": row.get("superLargeNetInflow"), "largeNetInflow": row.get("largeNetInflow"),
            "mediumNetInflow": row.get("mediumNetInflow"), "smallNetInflow": row.get("smallNetInflow"),
            "mainNetInflow3d": row.get("mainNetInflow3日"), "mainNetInflow5d": row.get("mainNetInflow5日"), "mainNetInflow10d": row.get("mainNetInflow10日"),
        })
    return {"dataDate": data_date or date.today().isoformat(), "source": "akshare/eastmoney", "generatedAt": datetime.now().astimezone().isoformat(), "rows": rows}


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch all-market stock money-flow rankings.")
    parser.add_argument("--output", type=Path, default=Path("data/realtime/fund-flow.json"))
    args = parser.parse_args()
    payload = fetch_payload(AkShareProvider())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    print(f"wrote {len(payload['rows'])} money-flow rows to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
