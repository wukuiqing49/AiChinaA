import json

import pytest

from pipeline.jobs.publish_screener import load_payload


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
        "tradeDate": "2026-08-25",
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
