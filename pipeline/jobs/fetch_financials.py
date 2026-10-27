from __future__ import annotations

import argparse
import json
import math
from datetime import date, datetime
from pathlib import Path

import pandas as pd

from pipeline.jobs.snapshot_universe import load_universe_codes


def num(v: object) -> float | None:
    x = pd.to_numeric(v, errors="coerce")
    return None if pd.isna(x) or not math.isfinite(float(x)) else float(x)


def latest_report(today: date) -> str:
    periods = [
        date(today.year - 1, 12, 31),
        date(today.year, 3, 31),
        date(today.year, 6, 30),
        date(today.year, 9, 30),
    ]
    return max(item for item in periods if item <= today).strftime("%Y%m%d")


def fetch_report(ak: object, report: str, today: date) -> list[dict[str, object]]:
    performance = ak.stock_yjbb_em(date=report)
    balance = ak.stock_zcfz_em(date=report)
    left = pd.DataFrame(
        {
            "code": performance["股票代码"].astype(str).str.zfill(6),
            "announcementDate": performance["最新公告日期"].astype(str),
            "roe": performance["净资产收益率"].map(num),
            "revenueYoy": performance["营业总收入-同比增长"].map(num),
            "profitYoy": performance["净利润-同比增长"].map(num),
            "grossMargin": performance["销售毛利率"].map(num),
            "revenue": performance["营业总收入-营业总收入"].map(num),
            "netProfit": performance["净利润-净利润"].map(num),
        }
    )
    right = pd.DataFrame(
        {
            "code": balance["股票代码"].astype(str).str.zfill(6),
            "debtRatio": balance["资产负债率"].map(num),
        }
    )
    merged = left.merge(right, on="code", how="outer").drop_duplicates("code")
    merged["reportDate"] = f"{report[:4]}-{report[4:6]}-{report[6:]}"
    merged["announcementDate"] = pd.to_datetime(merged["announcementDate"], errors="coerce").dt.strftime("%Y-%m-%d")
    merged = merged.loc[merged["announcementDate"].notna() & (merged["announcementDate"] <= today.isoformat())]
    return merged.astype(object).where(pd.notna(merged), None).to_dict(orient="records")


def report_periods(today: date) -> list[str]:
    periods = [date(year, month, day) for year in range(today.year - 2, today.year + 1)
               for month, day in [(3, 31), (6, 30), (9, 30), (12, 31)]]
    return [item.strftime("%Y%m%d") for item in sorted(periods, reverse=True) if item <= today][:5]


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch latest disclosed financials per stock.")
    parser.add_argument("--output", type=Path, default=Path("data/realtime/financials.json"))
    parser.add_argument("--report-date", default="")
    parser.add_argument("--universe", type=Path, default=Path("data/historical/checkpoints.json"))
    args = parser.parse_args()
    from zoneinfo import ZoneInfo
    today = datetime.now(ZoneInfo("Asia/Shanghai")).date()
    import akshare as ak
    codes = load_universe_codes(args.universe)
    selected = {}
    errors = []
    periods = [args.report_date] if args.report_date else report_periods(today)
    for report in periods:
        try:
            for row in fetch_report(ak, report, today):
                if row["code"] in codes:
                    selected.setdefault(row["code"], row)
        except Exception as error:
            errors.append(f"{report}: {error}")
        if len(selected) >= len(codes) * 0.98:
            break
    rows = list(selected.values())
    if not rows or len(rows) < len(codes) * 0.8:
        raise RuntimeError(f"Incomplete financial coverage: {len(rows)}/{len(codes)}; {errors}")
    payload = {"dataDate": today.isoformat(), "reportDate": max(row["reportDate"] for row in rows),
               "source": "akshare/eastmoney", "generatedAt": datetime.now().astimezone().isoformat(),
               "rows": rows, "quality": {"expectedRows": len(codes), "coverage": len(rows) / len(codes)}}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, allow_nan=False), encoding="utf-8"
    )
    print(f"wrote {len(rows)} financial rows to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
