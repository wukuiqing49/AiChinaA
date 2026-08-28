from __future__ import annotations

import json

import pandas as pd

from pipeline.jobs.download_history import repair_checkpoint_names


class MetadataProvider:
    def get_stock_list(self) -> pd.DataFrame:
        return pd.DataFrame({"code": ["000001"], "name": ["Ping An Bank"]})

    def get_etf_list(self) -> pd.DataFrame:
        return pd.DataFrame({"code": ["510300"], "name": ["CSI 300 ETF"]})


def test_repair_checkpoint_names_updates_metadata_without_quotes(tmp_path) -> None:
    checkpoint_file = tmp_path / "checkpoints.json"
    checkpoint_file.write_text(
        json.dumps(
            {
                "000001": {"code": "000001", "name": "000001", "type": "stock"},
                "510300": {"code": "510300", "name": "510300", "type": "etf"},
            }
        ),
        encoding="utf-8",
    )

    summary = repair_checkpoint_names(MetadataProvider(), data_dir=tmp_path)

    repaired = json.loads(checkpoint_file.read_text(encoding="utf-8"))
    assert summary["updated"] == 2
    assert repaired["000001"]["name"] == "Ping An Bank"
    assert repaired["510300"]["name"] == "CSI 300 ETF"
    assert not list(tmp_path.glob("**/*.parquet"))
