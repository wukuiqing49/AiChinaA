from __future__ import annotations

import argparse
import json
from datetime import date, datetime
from pathlib import Path
from typing import TYPE_CHECKING

import pandas as pd

if TYPE_CHECKING:
    from pipeline.providers.akshare_provider import AkShareProvider


def _number(value: object) -> float | None:
    number = pd.to_numeric(value, errors="coerce")
    return None if pd.isna(number) else float(number)


def _column(frame: pd.DataFrame, name: str) -> pd.Series:
    if name not in frame.columns:
        raise ValueError(f"industry fund-flow response is missing {name!r}")
    return frame[name]


def _optional_column(frame: pd.DataFrame, name: str) -> pd.Series:
    return frame[name] if name in frame.columns else pd.Series([None] * len(frame), index=frame.index)


def normalize(frame: pd.DataFrame) -> list[dict[str, object]]:
    industry = _column(frame, "\u884c\u4e1a").astype(str).str.strip()
    inflow = _column(frame, "\u6d41\u5165\u8d44\u91d1").map(_number)
    outflow = _column(frame, "\u6d41\u51fa\u8d44\u91d1").map(_number)
    net_inflow = _column(frame, "\u51c0\u989d").map(_number)
    company_count = _optional_column(frame, "\u516c\u53f8\u5bb6\u6570").map(_number)
    pct_change = _optional_column(frame, "\u884c\u4e1a-\u6da8\u8dcc\u5e45").map(_number)

    rows: list[dict[str, object]] = []
    # AKShare documents these three money columns in 100 million CNY. Store CNY
    # so all monetary fields returned by the Worker share one unit.
    for index, name in industry.items():
        if not name or inflow.loc[index] is None or outflow.loc[index] is None or net_inflow.loc[index] is None:
            continue
        rows.append(
            {
                "industry": name,
                "inflowAmount": inflow.loc[index] * 1e8,
                "outflowAmount": outflow.loc[index] * 1e8,
                "netInflow": net_inflow.loc[index] * 1e8,
                "companyCount": int(company_count.loc[index]) if company_count.loc[index] is not None else None,
                "pctChange": pct_change.loc[index],
            }
        )
    return rows


def fetch_payload(provider: "AkShareProvider", data_date: str | None = None) -> dict[str, object]:
    rows = normalize(provider.get_industry_fund_flow())
    if not rows:
        raise RuntimeError("industry fund-flow snapshot contains no usable sectors")
    return {
        "dataDate": data_date or date.today().isoformat(),
        "source": "akshare/ths-industry-fund-flow",
        "generatedAt": datetime.now().astimezone().isoformat(),
        "rows": rows,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch the live industry fund-flow heatmap source.")
    parser.add_argument("--output", type=Path, default=Path("data/realtime/industry-fund-flow.json"))
    args = parser.parse_args()
    from pipeline.providers.akshare_provider import AkShareProvider

    payload = fetch_payload(AkShareProvider())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    print(f"wrote {len(payload['rows'])} industry fund-flow rows to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
