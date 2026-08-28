from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from urllib.request import Request, urlopen


def main() -> int:
    parser = argparse.ArgumentParser(description="Publish the valuation snapshot to the Worker.")
    parser.add_argument("--input", type=Path, default=Path("data/realtime/valuation.json"))
    parser.add_argument("--url", default=os.environ.get("PUBLISH_URL", "").replace("/publish-screener", "/publish-valuation"))
    parser.add_argument("--secret", default=os.environ.get("PUBLISH_SECRET", ""))
    args = parser.parse_args()
    payload = json.loads(args.input.read_text(encoding="utf-8"))
    request = Request(args.url, data=json.dumps(payload, ensure_ascii=False).encode("utf-8"), headers={"Content-Type": "application/json", "X-Publish-Secret": args.secret}, method="POST")
    with urlopen(request, timeout=90) as response:
        print(response.read().decode("utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
