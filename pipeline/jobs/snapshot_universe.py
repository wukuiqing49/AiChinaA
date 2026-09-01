from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def load_universe_codes(path: Path) -> set[str]:
    """Load the stock codes represented by the restored historical snapshot."""
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"universe checkpoint must be an object: {path}")

    codes = {str(code).zfill(6) for code in payload if str(code).zfill(6).isdigit()}
    if not codes:
        raise ValueError(f"universe checkpoint contains no stock codes: {path}")
    return codes


def filter_rows_to_universe(rows: list[dict[str, Any]], codes: set[str]) -> list[dict[str, Any]]:
    """Keep only publishable records for the stock universe in the current snapshot."""
    return [row for row in rows if str(row.get("code", "")).zfill(6) in codes]
