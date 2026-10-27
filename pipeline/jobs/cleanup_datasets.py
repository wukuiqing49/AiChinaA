from __future__ import annotations

import os
from pipeline.jobs.publish_screener import publish_payload


def main() -> int:
    url = os.environ["PUBLISH_URL"].removesuffix("/publish-screener") + "/cleanup-datasets"
    for _ in range(500):
        result = publish_payload({}, url=url, secret=os.environ["PUBLISH_SECRET"], timeout=90)
        if result.get("status") == "completed":
            print("Dataset cleanup completed")
            return 0
    print("Dataset cleanup reached its bounded budget; continue next run")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
