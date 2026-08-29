from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from urllib.request import Request, urlopen


def main() -> int:
    parser = argparse.ArgumentParser(description="Publish stock-to-industry mapping to the Worker.")
    parser.add_argument("--input", type=Path, default=Path("data/realtime/industry-map.json"))
    parser.add_argument("--url", default=os.environ.get("INDUSTRY_PUBLISH_URL", "") or os.environ.get("PUBLISH_URL", "").replace("/publish-screener", "/publish-industry-map"))
    parser.add_argument("--secret", default=os.environ.get("PUBLISH_SECRET", ""))
    args = parser.parse_args()
    if not args.url or not args.secret:
        raise ValueError("publish URL and secret are required")
    payload = json.loads(args.input.read_text(encoding="utf-8"))
    request = Request(args.url, data=json.dumps(payload, ensure_ascii=False).encode("utf-8"), headers={"Content-Type": "application/json", "X-Publish-Secret": args.secret}, method="POST")
    with urlopen(request, timeout=120) as response:
        print(response.read().decode("utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
