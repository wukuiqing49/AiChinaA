import pandas as pd

from pipeline.universe import (
    classify_instrument,
    filter_universe,
    is_etf,
    is_main_board_stock,
)


def test_is_main_board_stock():
    # Shanghai Main Board
    assert is_main_board_stock("600519", "贵州茅台")
    assert is_main_board_stock("601318", "中国平安")
    assert is_main_board_stock("603259", "药明康德")
    assert is_main_board_stock("605117", "德业股份")

    # Shenzhen Main Board
    assert is_main_board_stock("000001", "平安银行")
    assert is_main_board_stock("000858", "五粮液")
    assert is_main_board_stock("002594", "比亚迪")

    # ChiNext / STAR / BSE should be rejected
    assert not is_main_board_stock("300750", "宁德时代")
    assert not is_main_board_stock("688981", "中芯国际")
    assert not is_main_board_stock("920002", "万达轴承")
    assert not is_main_board_stock("430047", "诺思兰德")

    # ST stocks should be rejected if exclude_st=True
    assert not is_main_board_stock("600001", "*ST某某", exclude_st=True)
    assert not is_main_board_stock("000002", "ST某某", exclude_st=True)
    assert is_main_board_stock("600001", "*ST某某", exclude_st=False)


def test_is_etf():
    # Shanghai ETFs
    assert is_etf("510300")
    assert is_etf("510500")
    assert is_etf("588000")
    assert is_etf("560010")

    # Shenzhen ETFs
    assert is_etf("159915")
    assert is_etf("159919")

    # Non-ETFs
    assert not is_etf("600519")
    assert not is_etf("000001")


def test_classify_instrument():
    assert classify_instrument("600519", "贵州茅台") == "stock"
    assert classify_instrument("000001", "平安银行") == "stock"
    assert classify_instrument("510300", "300ETF") == "etf"
    assert classify_instrument("159915", "创业板ETF") == "etf"
    assert classify_instrument("sh000001", "上证指数") == "index"
    assert classify_instrument("sz399001", "深证成指") == "index"
    assert classify_instrument("688981", "中芯国际") == "other"
    assert classify_instrument("300750", "宁德时代") == "other"


def test_filter_universe():
    df = pd.DataFrame({
        "code": ["600519", "000001", "688981", "300750", "510300", "159915", "600002"],
        "name": ["贵州茅台", "平安银行", "中芯", "宁德", "300ETF", "创业板ETF", "*ST某某"],
    })
    filtered = filter_universe(df, allow_stocks=True, allow_etfs=True, exclude_st=True)
    codes = set(filtered["code"])
    assert codes == {"600519", "000001", "510300", "159915"}
