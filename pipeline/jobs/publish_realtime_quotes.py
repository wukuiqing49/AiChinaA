from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from pipeline.jobs.publish_screener import publish_payload

REQUIRED_QUOTE_FIELDS = {
    "code",
    "instrumentType",
    "close",
    "pctChange",
    "quoteDate",
    "quoteTime",
    "quoteSource",
}
DEFAULT_PUBLISH_TIMEOUT_SECONDS = 180


def _default_url() -> str:
    url = os.environ.get("PUBLISH_URL", "")
    return url.removesuffix("/publish-screener") + "/publish-realtime-quotes"


def load_payload(path: Path) -> dict[str, object]:
    snapshot = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(snapshot, dict) or not isinstance(snapshot.get("quotes"), dict):
        raise ValueError("real-time quote snapshot must contain a quotes object")
    quotes = list(snapshot["quotes"].values())
    if not 0 < len(quotes) <= 6000:
        raise ValueError("real-time quote snapshot must contain 1-6000 quotes")
    for index, quote in enumerate(quotes):
        if not isinstance(quote, dict) or not REQUIRED_QUOTE_FIELDS.issubset(quote):
            raise ValueError(f"quote row {index} is missing required fields")
    payload: dict[str, object] = {"quotes": quotes}
    if isinstance(snapshot.get("generatedAt"), str):
        payload["generatedAt"] = snapshot["generatedAt"]
    return payload


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Publish a real-time quote snapshot to the Worker."
    )
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--url", default=_default_url())
    parser.add_argument("--secret", default=os.environ.get("PUBLISH_SECRET", ""))
    parser.add_argument(
        "--timeout",
        type=int,
        default=int(
            os.environ.get(
                "REALTIME_PUBLISH_TIMEOUT_SECONDS", DEFAULT_PUBLISH_TIMEOUT_SECONDS
            )
        ),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.timeout < 1:
        raise ValueError("publish timeout must be at least one second")
    payload = load_payload(args.input)
    result = publish_payload(payload, url=args.url, secret=args.secret, timeout=args.timeout)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
