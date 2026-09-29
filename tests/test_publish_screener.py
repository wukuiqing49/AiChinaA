import json
from io import BytesIO
from urllib.error import HTTPError, URLError

import pytest

from pipeline.jobs.publish_screener import (
    DEFAULT_PUBLISH_TIMEOUT_SECONDS,
    load_payload,
    publish_payload,
)


def test_default_publish_timeout_allows_full_market_d1_publish() -> None:
    assert DEFAULT_PUBLISH_TIMEOUT_SECONDS == 300


def test_load_payload_requires_all_screen_fields(tmp_path):
    payload_path = tmp_path / "payload.json"
    payload_path.write_text(
        json.dumps({"runId": "run-20260825", "tradeDate": "2026-08-25", "stocks": [{}]})
    )

    with pytest.raises(ValueError, match="missing required fields"):
        load_payload(payload_path)


def test_load_payload_accepts_valid_row(tmp_path):
    fields = {
        "code": "600001",
        "name": "Alpha",
        "instrumentType": "stock",
        "isSt": False,
        "tradeDate": "2026-08-25",
        "quoteDate": None,
        "quoteTime": None,
        "quoteSource": None,
        "close": 10,
        "scoreTotal": 80,
        "dataCompleteness": 1, "market": "SH", "industry": "Test", "pctChange": 1,
        "turnoverRate": 2, "ret5d": 1, "ret20d": 3, "ret60d": 4, "ma20Slope": 0.1,
        "volumeRatio20": 1.2, "volatility20": 0.2,
    }
    payload_path = tmp_path / "payload.json"
    payload_path.write_text(
        json.dumps({"runId": "run-20260825", "tradeDate": "2026-08-25", "stocks": [fields]})
    )

    assert load_payload(payload_path)["runId"] == "run-20260825"


def test_publish_retries_connection_failure(monkeypatch):
    calls = []
    requests = []
    monkeypatch.setattr(
        "pipeline.jobs.publish_screener.time.sleep", lambda seconds: calls.append(seconds)
    )

    def urlopen(request, timeout):
        requests.append(request)
        calls.append(timeout)
        if len(requests) < 4:
            raise URLError("connection closed")
        return BytesIO(b'{"status":"completed"}')

    monkeypatch.setattr("pipeline.jobs.publish_screener.urlopen", urlopen)
    result = publish_payload(
        {"runId": "run-20260825"}, url="https://example.test", secret="secret", timeout=3
    )
    assert result == {"status": "completed"}
    assert calls == [3, 60, 3, 180, 3, 300, 3]
    assert len({request.data for request in requests}) == 1


def test_publish_does_not_retry_bad_request(monkeypatch):
    calls = []

    def urlopen(request, timeout):
        calls.append(timeout)
        raise HTTPError(request.full_url, 400, "Bad Request", {}, BytesIO(b"invalid payload"))

    monkeypatch.setattr("pipeline.jobs.publish_screener.urlopen", urlopen)
    with pytest.raises(RuntimeError, match="HTTP 400: invalid payload"):
        publish_payload({}, url="https://example.test", secret="secret")
    assert calls == [300]
