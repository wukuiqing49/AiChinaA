from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from time import sleep

import pandas as pd


def _first_column(frame: pd.DataFrame, candidates: tuple[str, ...]) -> str | None:
    return next((column for column in candidates if column in frame.columns), None)


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch the Eastmoney stock-to-industry mapping for the sector heatmap.")
    parser.add_argument("--output", type=Path, default=Path("data/realtime/industry-map.json"))
    parser.add_argument("--delay", type=float, default=0.12, help="Seconds between industry constituent requests.")
    args = parser.parse_args()
    import akshare as ak

    boards = ak.stock_board_industry_name_em()
    name_column = _first_column(boards, ("板块名称", "名称"))
    if name_column is None:
        raise ValueError("industry board response has no board-name column")

    mapping: dict[str, str] = {}
    failures: list[str] = []
    for board in boards[name_column].dropna().astype(str).str.strip():
        if not board:
            continue
        try:
            constituents = ak.stock_board_industry_cons_em(symbol=board)
            code_column = _first_column(constituents, ("代码", "证券代码"))
            if code_column is None:
                failures.append(f"{board}: missing code column")
                continue
            for raw_code in constituents[code_column].dropna().astype(str):
                code = raw_code.strip().zfill(6)
                if code.isdigit() and len(code) == 6:
                    mapping[code] = board
        except Exception as error:  # Individual industries can be retried next refresh.
            failures.append(f"{board}: {type(error).__name__}")
        sleep(max(args.delay, 0))

    if not mapping:
        raise RuntimeError("industry mapping returned no stock codes")
    payload = {
        "source": "akshare/eastmoney-industry",
        "generatedAt": datetime.now().astimezone().isoformat(),
        "rows": [{"code": code, "industry": industry} for code, industry in sorted(mapping.items())],
        "failedBoards": failures,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    print(f"wrote {len(mapping)} industry mappings to {args.output}; failed boards: {len(failures)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
