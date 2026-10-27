from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

from pipeline.providers.akshare_provider import AkShareProvider


def is_trading_day(calendar: pd.DataFrame, today: str) -> bool:
    dates = pd.to_datetime(calendar.iloc[:, 0], errors="raise").dt.strftime("%Y-%m-%d")
    if not len(dates) or today > str(dates.max()):
        raise RuntimeError("Trading calendar is incomplete for today's date")
    return today in set(dates)


def main() -> int:
    # Manual recovery may intentionally run outside market hours or on holidays.
    manual = os.environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch"
    today = datetime.now(ZoneInfo("Asia/Shanghai")).date().isoformat()
    opened = manual or is_trading_day(AkShareProvider().get_trade_calendar(), today)
    if path := os.environ.get("GITHUB_OUTPUT"):
        with Path(path).open("a", encoding="utf-8") as output:
            output.write(f"is_open={'true' if opened else 'false'}\n")
            output.write(f"expected_trade_date={'' if manual else today}\n")
    print(f"{today}: trading day={opened}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
