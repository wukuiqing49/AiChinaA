from __future__ import annotations

import argparse
import json
from datetime import date, datetime
from pathlib import Path

import pandas as pd


def _number(value: object) -> float | None:
    number = pd.to_numeric(value, errors="coerce")
    return None if pd.isna(number) else float(number)


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch the all-market valuation snapshot.")
    parser.add_argument("--output", type=Path, default=Path("data/realtime/valuation.json"))
    args = parser.parse_args()
    import akshare as ak
    frame = ak.stock_zh_a_spot_em()
    rows = []
    for item in frame.to_dict(orient="records"):
        code = str(item.get("代码", "")).strip().zfill(6)
        if not code.isdigit() or len(code) != 6:
            continue
        rows.append({"code": code, "peTtm": _number(item.get("市盈率-动态")), "pb": _number(item.get("市净率")), "totalMarketCap": _number(item.get("总市值")), "floatMarketCap": _number(item.get("流通市值"))})
    payload = {"dataDate": date.today().isoformat(), "source": "akshare/eastmoney", "generatedAt": datetime.now().astimezone().isoformat(), "rows": rows}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    print(f"wrote {len(rows)} valuation rows to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
