from __future__ import annotations

import json

import pytest

from pipeline.jobs.fetch_realtime_quotes import _targets_from_universe
from pipeline.jobs.publish_realtime_quotes import load_payload


def test_targets_from_universe_accepts_all_supported_instruments(tmp_path) -> None:
    universe_file = tmp_path / "market-universe.json"
    universe_file.write_text(
        json.dumps(
            {
                "targets": [
                    {"code": "000001", "instrumentType": "stock"},
                    {"code": "510300", "instrumentType": "etf"},
                    {"code": "sh000001", "instrumentType": "index"},
                    {"code": "000001", "instrumentType": "stock"},
                    {"code": "bad", "instrumentType": "future"},
                ]
            }
        ),
        encoding="utf-8",
    )

    assert _targets_from_universe(universe_file) == [
        ("000001", "stock"),
        ("510300", "etf"),
        ("sh000001", "index"),
    ]


def test_targets_from_universe_rejects_an_empty_payload(tmp_path) -> None:
    universe_file = tmp_path / "market-universe.json"
    universe_file.write_text('{"targets": []}', encoding="utf-8")

    with pytest.raises(ValueError, match="no supported targets"):
        _targets_from_universe(universe_file)


def test_realtime_publish_payload_uses_all_snapshot_quotes(tmp_path) -> None:
    snapshot_file = tmp_path / "quotes.json"
    snapshot_file.write_text(
        json.dumps(
            {
                "generatedAt": "2026-09-01T08:00:00+00:00",
                "quotes": {
                    "stock:000001": {
                        "code": "000001",
                        "instrumentType": "stock",
                        "close": 12.5,
                        "pctChange": 1.2,
                        "quoteDate": "2026-09-01",
                        "quoteTime": "16:00:00",
                        "quoteSource": "tencent",
                    }
                },
            }
        ),
        encoding="utf-8",
    )

    payload = load_payload(snapshot_file)

    assert payload["generatedAt"] == "2026-09-01T08:00:00+00:00"
    assert payload["quotes"] == [
        {
            "code": "000001",
            "instrumentType": "stock",
            "close": 12.5,
            "pctChange": 1.2,
            "quoteDate": "2026-09-01",
            "quoteTime": "16:00:00",
            "quoteSource": "tencent",
        }
    ]
