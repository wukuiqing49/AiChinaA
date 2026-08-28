from __future__ import annotations

import argparse
import json
import re
import time
from datetime import UTC, datetime
from pathlib import Path
from urllib.request import Request, urlopen

from pipeline.universe import CORE_INDICES

QUOTE_TIMESTAMP = re.compile(r"^\d{14}$")


def _symbol(code: str, instrument_type: str) -> str:
    if instrument_type == "index":
        return code
    return f"{'sh' if code.startswith(('5', '6')) else 'sz'}{code}"


def _quote_key(code: str, instrument_type: str) -> str:
    return f"{instrument_type}:{code}"


def _targets(data_dir: Path) -> list[tuple[str, str]]:
    checkpoints = json.loads((data_dir / "checkpoints.json").read_text(encoding="utf-8"))
    targets = [
        (str(item["code"]), str(item.get("type", "stock")))
        for item in checkpoints.values()
        if item.get("status") == "success" and item.get("type") in {"stock", "etf"}
    ]
    targets.extend((item["code"], "index") for item in CORE_INDICES)
    return targets


def parse_tencent_response(
    body: str, target_by_symbol: dict[str, tuple[str, str, str]]
) -> dict[str, dict[str, object]]:
    quotes: dict[str, dict[str, object]] = {}
    for line in body.split(";"):
        if "=\"" not in line:
            continue
        variable, encoded = line.strip().split("=\"", 1)
        symbol = variable.removeprefix("v_")
        target = target_by_symbol.get(symbol)
        if target is None:
            continue
        fields = encoded.rstrip('"').split("~")
        if len(fields) < 31 or not QUOTE_TIMESTAMP.fullmatch(fields[30]):
            continue
        try:
            close, previous = float(fields[3]), float(fields[4])
        except ValueError:
            continue
        if close <= 0 or previous <= 0:
            continue
        key, code, instrument_type = target
        stamp = fields[30]
        quotes[key] = {
            "code": code,
            "instrumentType": instrument_type,
            "close": close,
            "pctChange": round((close / previous - 1) * 100, 6),
            "quoteDate": f"{stamp[:4]}-{stamp[4:6]}-{stamp[6:8]}",
            "quoteTime": f"{stamp[8:10]}:{stamp[10:12]}:{stamp[12:14]}",
        }
    return quotes


def _fetch_batch(batch: list[tuple[str, str]], attempts: int = 3) -> dict[str, dict[str, object]]:
    target_by_symbol = {
        _symbol(code, kind): (_quote_key(code, kind), code, kind) for code, kind in batch
    }
    request = Request(
        "https://qt.gtimg.cn/q=" + ",".join(target_by_symbol),
        headers={"User-Agent": "Mozilla/5.0"},
    )
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            with urlopen(request, timeout=15) as response:
                body = response.read().decode("gbk", errors="replace")
            return parse_tencent_response(body, target_by_symbol)
        except Exception as error:  # Network failures are retried at the batch boundary.
            last_error = error
            if attempt + 1 < attempts:
                time.sleep(1.5 * (attempt + 1))
    assert last_error is not None
    raise last_error


def fetch_realtime_quotes(data_dir: Path, output: Path) -> dict[str, object]:
    quotes: dict[str, dict[str, object]] = {}
    failed_batches = 0
    targets = _targets(data_dir)
    for start in range(0, len(targets), 50):
        batch = targets[start : start + 50]
        try:
            quotes.update(_fetch_batch(batch))
        except Exception as error:
            failed_batches += 1
            print(f"real-time batch {start // 50 + 1} failed: {type(error).__name__}: {error}")
    payload = {"generatedAt": datetime.now(UTC).isoformat(), "quotes": quotes}
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    temporary.replace(output)
    return {
        "targets": len(targets),
        "saved": len(quotes),
        "failedBatches": failed_batches,
        "output": str(output),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch a Tencent real-time market snapshot.")
    parser.add_argument("--data-dir", type=Path, default=Path("data/historical"))
    parser.add_argument("--output", type=Path, default=Path("data/realtime/tencent-quotes.json"))
    args = parser.parse_args()
    result = fetch_realtime_quotes(args.data_dir, args.output)
    print(result)
    return 1 if result["saved"] == 0 else 0


if __name__ == "__main__":
    raise SystemExit(main())
