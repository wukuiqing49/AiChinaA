"""Check publish credentials and required schema before expensive data collection."""

from __future__ import annotations

import argparse
import os

from pipeline.jobs.publish_screener import publish_payload


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dataset",
        default="screener",
        choices=(
            "screener",
            "industry-map",
            "fund-flow",
            "industry-fund-flow",
            "valuation",
            "financials",
            "realtime-quotes",
        ),
    )
    args = parser.parse_args()
    base, separator, _ = os.environ["PUBLISH_URL"].rstrip("/").rpartition("/publish-")
    if not separator:
        raise ValueError("PUBLISH_URL must end with /publish-<dataset>")
    result = publish_payload(
        {"operation": "preflight", "runId": "preflight-check"},
        url=f"{base}/publish-{args.dataset}",
        secret=os.environ["PUBLISH_SECRET"],
        timeout=30,
    )
    if result.get("status") != "ready" or result.get("dataset") != args.dataset:
        raise RuntimeError(f"Invalid publish preflight response: {result}")
    print(
        f"Publish preflight ready: {args.dataset} (schema v{result['schemaVersion']})", flush=True
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
