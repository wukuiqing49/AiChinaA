import json

import pytest

from pipeline.jobs.snapshot_universe import filter_rows_to_universe, load_universe_codes


def test_load_and_filter_snapshot_universe(tmp_path) -> None:
    checkpoint = tmp_path / "checkpoints.json"
    checkpoint.write_text(json.dumps({"000001": {}, "600519": {}}), encoding="utf-8")

    codes = load_universe_codes(checkpoint)

    assert codes == {"000001", "600519"}
    assert filter_rows_to_universe(
        [{"code": "1"}, {"code": "600519"}, {"code": "900001"}], codes
    ) == [{"code": "1"}, {"code": "600519"}]


def test_load_universe_rejects_empty_checkpoint(tmp_path) -> None:
    checkpoint = tmp_path / "checkpoints.json"
    checkpoint.write_text("{}", encoding="utf-8")

    with pytest.raises(ValueError, match="no stock codes"):
        load_universe_codes(checkpoint)
