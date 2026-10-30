import json

import pandas as pd
import pytest
import requests

from pipeline.jobs.fetch_fund_flow import fetch_payload
from pipeline.providers import eastmoney_snapshot as snapshot


def test_snapshot_retries_failed_page_on_another_host(monkeypatch):
    calls = []

    def get(self, url, *, params, timeout):
        calls.append((url, params["pn"]))
        if len(calls) == 2:
            raise requests.ConnectionError("remote disconnected")
        code = "000001" if params["pn"] == 1 else "600000"
        count = 100 if params["pn"] == 1 else 1
        rows = [{"f12": f"{i:06d}", "f9": 10} for i in range(count)]
        if count == 1:
            rows[0]["f12"] = code
        response = requests.Response()
        response.status_code = 200
        response._content = json.dumps({"data": {"total": 101, "diff": rows}}).encode()
        return response

    monkeypatch.setattr(requests.Session, "get", get)
    monkeypatch.setattr(snapshot, "sleep", lambda _: None)
    frame = snapshot.fetch_snapshot({"f12": "代码", "f9": "pe"})
    assert len(frame) == 101
    assert [page for _, page in calls] == [1, 2, 2]
    assert calls[1][0] != calls[2][0]


def test_snapshot_rejects_invalid_response_after_bounded_attempts(monkeypatch):
    calls = []

    def get(*args, **kwargs):
        calls.append(1)
        response = requests.Response()
        response.status_code = 200
        response._content = b"<html>unavailable</html>"
        return response

    monkeypatch.setattr(requests.Session, "get", get)
    monkeypatch.setattr(snapshot, "sleep", lambda _: None)
    with pytest.raises(RuntimeError, match="snapshot unavailable"):
        snapshot.fetch_snapshot({"f12": "代码"})
    assert len(calls) == 6


def test_fund_flow_missing_windows_are_json_null():
    class Provider:
        def get_individual_fund_flow_rank(self, window):
            return pd.DataFrame({
                "代码": ["000001" if window == "今日" else "600000"],
                f"{window}主力净流入-净额": [10],
            })

    payload = fetch_payload(Provider())
    json.dumps(payload, allow_nan=False)
    assert payload["rows"][0]["mainNetInflow3d"] is None
