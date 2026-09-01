from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from pipeline.jobs.publish_screener import publish_payload


def publish(path: Path, url: str, secret: str, *, persist_history: bool = False) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or not isinstance(payload.get("rows"), list):
        raise ValueError("industry fund-flow payload must contain rows")
    if persist_history:
        payload["persistHistory"] = True
    return publish_payload(payload, url=url, secret=secret, timeout=90)


def main() -> int:
    parser = argparse.ArgumentParser(description="Publish the live industry fund-flow package to the Worker.")
    parser.add_argument("--input", type=Path, default=Path("data/realtime/industry-fund-flow.json"))
    default_url = os.environ.get("INDUSTRY_FUND_FLOW_PUBLISH_URL", "") or os.environ.get(
        "PUBLISH_URL", ""
    ).replace("/publish-screener", "/publish-industry-fund-flow")
    parser.add_argument("--url", default=default_url)
    parser.add_argument("--secret", default=os.environ.get("PUBLISH_SECRET", ""))
    parser.add_argument("--persist-history", action="store_true")
    args = parser.parse_args()
    print(json.dumps(publish(args.input, args.url, args.secret, persist_history=args.persist_history), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
