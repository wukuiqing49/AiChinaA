from __future__ import annotations

import argparse
import json
import os
from pathlib import Path


def publish(path: Path, url: str, secret: str) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or not isinstance(payload.get("rows"), list):
        raise ValueError("fund-flow payload must contain rows")
    if not url or not secret:
        raise ValueError("publish URL and secret are required")
    from pipeline.publishing import publish_dataset
    return publish_dataset(payload, url=url, secret=secret)



def main() -> int:
    parser = argparse.ArgumentParser(description="Publish the stock money-flow package to the Worker.")
    parser.add_argument("--input", type=Path, default=Path("data/realtime/fund-flow.json"))
    default_url = os.environ.get("FUND_FLOW_PUBLISH_URL", "") or os.environ.get("PUBLISH_URL", "").replace("/publish-screener", "/publish-fund-flow")
    parser.add_argument("--url", default=default_url)
    parser.add_argument("--secret", default=os.environ.get("PUBLISH_SECRET", ""))
    args = parser.parse_args()
    print(json.dumps(publish(args.input, args.url, args.secret), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
