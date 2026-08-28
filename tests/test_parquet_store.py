import pandas as pd

from pipeline.storage.parquet_store import (
    append_or_update_quotes,
    list_saved_codes,
    load_quotes_file,
    save_quotes,
)


def test_parquet_save_and_load(tmp_path):
    file_path = tmp_path / "600519.parquet"
    data = pd.DataFrame({
        "code": ["600519", "600519"],
        "trade_date": ["2024-01-02", "2024-01-03"],
        "open": [1600.0, 1610.0],
        "close": [1605.0, 1620.0],
        "volume": [10000, 12000],
    })

    save_quotes(data, file_path)
    loaded = load_quotes_file(file_path)
    assert len(loaded) == 2
    assert list(loaded["trade_date"]) == ["2024-01-02", "2024-01-03"]

    # Filter with date range
    filtered = load_quotes_file(file_path, start_date="2024-01-03")
    assert len(filtered) == 1
    assert filtered["trade_date"].iloc[0] == "2024-01-03"


def test_append_or_update_quotes(tmp_path):
    file_path = tmp_path / "600519.parquet"
    initial = pd.DataFrame({
        "code": ["600519"],
        "trade_date": ["2024-01-02"],
        "close": [1605.0],
    })
    append_or_update_quotes(initial, file_path)

    new_data = pd.DataFrame({
        "code": ["600519", "600519"],
        "trade_date": ["2024-01-02", "2024-01-03"],
        "close": [1608.0, 1620.0],  # 2024-01-02 updated
    })
    merged = append_or_update_quotes(new_data, file_path)

    assert len(merged) == 2
    # Verify deduplication kept the latest
    assert merged.loc[merged["trade_date"] == "2024-01-02", "close"].iloc[0] == 1608.0

    codes = list_saved_codes(tmp_path)
    assert codes == ["600519"]
