from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

REQUIRED_STOCK_FIELDS = {
    "code",
    "name",
    "instrumentType",
    "tradeDate",
    "close",
    "scoreTotal",
    "dataCompleteness",
    "market",
    "industry",
    "pctChange",
    "turnoverRate",
    "ret5d",
    "ret20d",
    "ret60d",
    "ma20Slope",
    "volumeRatio20",
    "volatility20",
}


def load_payload(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("publish payload must be a JSON object")
    if not isinstance(payload.get("runId"), str) or not isinstance(payload.get("tradeDate"), str):
        raise ValueError("publish payload requires runId and tradeDate")
    stocks = payload.get("stocks")
    if not isinstance(stocks, list) or not 0 < len(stocks) <= 6000:
        raise ValueError("publish payload stocks must contain 1-6000 rows")
    for index, stock in enumerate(stocks):
        if not isinstance(stock, dict) or not REQUIRED_STOCK_FIELDS.issubset(stock):
            raise ValueError(f"stock row {index} is missing required fields")
    indices = payload.get("indices", [])
    if not isinstance(indices, list) or len(indices) > 100:
        raise ValueError("publish payload indices must contain 0-100 rows")
    return payload


def publish_payload(
    payload: dict[str, object], *, url: str, secret: str, timeout: int = 60
) -> dict[str, object]:
    if not url or not secret:
        raise ValueError("publish URL and secret are required")
    request = Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": os.environ.get(
                "PUBLISH_USER_AGENT",
                "Mozilla/5.0 (compatible; AShareQuantPublisher/1.0; +https://github.com/wukuiqing49/AiChinaA)",
            ),
            "X-Publish-Secret": secret,
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"publish failed with HTTP {error.code}: {body}") from error
    except URLError as error:
        raise RuntimeError(f"publish request failed: {error.reason}") from error
    if not isinstance(result, dict):
        raise RuntimeError("publish response is not a JSON object")
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Publish a validated screener JSON package to the Worker."
    )
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--url", default=os.environ.get("PUBLISH_URL", ""))
    parser.add_argument("--secret", default=os.environ.get("PUBLISH_SECRET", ""))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    payload = load_payload(args.input)
    result = publish_payload(payload, url=args.url, secret=args.secret)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
