from __future__ import annotations
import argparse, json
from datetime import date, datetime
from pathlib import Path
import pandas as pd

def num(v: object) -> float | None:
    x = pd.to_numeric(v, errors="coerce")
    return None if pd.isna(x) else float(x)

def latest_report(today: date) -> str:
    periods = [date(today.year - 1, 12, 31), date(today.year, 3, 31), date(today.year, 6, 30), date(today.year, 9, 30)]
    return max(item for item in periods if item <= today).strftime("%Y%m%d")

def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch all-market financial-report snapshot.")
    parser.add_argument("--output", type=Path, default=Path("data/realtime/financials.json")); parser.add_argument("--report-date", default="")
    args = parser.parse_args(); report = args.report_date or latest_report(date.today())
    import akshare as ak
    performance = ak.stock_yjbb_em(date=report)
    balance = ak.stock_zcfz_em(date=report)
    left = pd.DataFrame({"code": performance["股票代码"].astype(str).str.zfill(6), "announcementDate": performance["最新公告日期"].astype(str), "roe": performance["净资产收益率"].map(num), "revenueYoy": performance["营业总收入-同比增长"].map(num), "profitYoy": performance["净利润-同比增长"].map(num), "grossMargin": performance["销售毛利率"].map(num), "revenue": performance["营业总收入-营业总收入"].map(num), "netProfit": performance["净利润-净利润"].map(num)})
    right = pd.DataFrame({"code": balance["股票代码"].astype(str).str.zfill(6), "debtRatio": balance["资产负债率"].map(num)})
    merged = left.merge(right, on="code", how="outer").drop_duplicates("code")
    rows = merged.to_dict(orient="records")
    payload = {"dataDate": date.today().isoformat(), "reportDate": f"{report[:4]}-{report[4:6]}-{report[6:]}", "source": "akshare/eastmoney", "generatedAt": datetime.now().astimezone().isoformat(), "rows": rows}
    args.output.parent.mkdir(parents=True, exist_ok=True); args.output.write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    print(f"wrote {len(rows)} financial rows to {args.output}"); return 0
if __name__ == "__main__": raise SystemExit(main())
