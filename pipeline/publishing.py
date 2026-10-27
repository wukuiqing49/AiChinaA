"""Bounded, resumable publication. A run ID always identifies one immutable artifact."""
from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from typing import Any

CHUNK_ROWS = 10


def publish_dataset(payload: dict[str, Any], *, url: str, secret: str, timeout: int = 90) -> dict[str, Any]:
    # Lazy import keeps the existing transport API usable by external callers.
    from pipeline.jobs.publish_screener import publish_payload

    encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()
    digest = hashlib.sha256(encoded).hexdigest()
    dataset = url.rstrip("/").rsplit("/", 1)[-1].removeprefix("publish-")
    keys = ["stocks", "indices"] if dataset == "screener" else ["quotes" if dataset == "realtime-quotes" else "rows"]
    meta = {key: value for key, value in payload.items() if key not in keys}
    if dataset == "screener":
        meta.setdefault("runKind", "full_market")
        meta["stockCount"] = len(payload.get("stocks", []))
        meta["indexCount"] = len(payload.get("indices", []))
    chunks = []
    for key in keys:
        rows = payload.get(key, [])
        if not isinstance(rows, list):
            raise ValueError(f"{key} must be an array")
        for offset in range(0, len(rows), CHUNK_ROWS):
            chunk = {name: [] for name in keys}
            chunk[key] = rows[offset:offset + CHUNK_ROWS]
            chunks.append(chunk)
    count = sum(len(payload.get(key, [])) for key in keys)
    if not chunks or count > 6100:
        raise ValueError("dataset must contain 1-6100 rows")
    dates = [str(row.get("quoteDate", "")) for row in payload.get("quotes", [])]
    data_date = payload.get("tradeDate") or payload.get("dataDate") or max(dates, default="")
    data_date = data_date or datetime.now(UTC).date().isoformat()
    run_id = str(payload.get("runId") or f"publish-{dataset}-{digest[:24]}")

    def send(operation: str, **fields: Any) -> dict[str, Any]:
        result = publish_payload({"operation": operation, "runId": run_id, **fields}, url=url, secret=secret, timeout=timeout)
        if result.get("runId") != run_id or result.get("status") not in ("running", "completed"):
            raise RuntimeError(f"invalid publish {operation} response: {result}")
        return result

    state = send("begin", schemaVersion=2, dataDate=data_date, expectedRows=count,
                 expectedChunks=len(chunks), payloadHash=digest, meta=meta)
    if state["status"] == "completed":
        return state
    accepted = state.get("acceptedChunks")
    if not isinstance(accepted, list) or any(type(index) is not int or not 0 <= index < len(chunks) for index in accepted):
        raise RuntimeError("invalid accepted publish chunks")
    accepted_set = set(accepted)
    for index, chunk in enumerate(chunks):
        if index not in accepted_set:
            send("chunk", chunkIndex=index, payload=chunk)
        if (index + 1) % 50 == 0 or index + 1 == len(chunks):
            print(f"publish {dataset}: {index + 1}/{len(chunks)} chunks", flush=True)
    result = send("commit")
    if result["status"] != "completed":
        raise RuntimeError("publish did not complete")
    return result
