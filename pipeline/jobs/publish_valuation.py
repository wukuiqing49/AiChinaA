from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from pipeline.publishing import publish_dataset


def main() -> int:
    parser = argparse.ArgumentParser(description="Publish valuation with bounded, resumable chunks.")
    parser.add_argument("--input", type=Path, default=Path("data/realtime/valuation.json"))
    parser.add_argument("--url", default=os.environ.get("PUBLISH_URL", "").removesuffix("/publish-screener") + "/publish-valuation")
    parser.add_argument("--secret", default=os.environ.get("PUBLISH_SECRET", ""))
    args = parser.parse_args()
    payload = json.loads(args.input.read_text(encoding="utf-8"))
    print(json.dumps(publish_dataset(payload, url=args.url, secret=args.secret), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
