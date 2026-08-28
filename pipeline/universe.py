from __future__ import annotations

import re

import pandas as pd

MAIN_BOARD_STOCK_PATTERN = re.compile(r"^(60[0135]\d{3}|00[012]\d{3})$")
ETF_PATTERN = re.compile(r"^(5[168]\d{4}|1[56]\d{4})$")
ST_NAME_PATTERN = re.compile(r"(ST|\*ST|退市|PT)", re.IGNORECASE)

CORE_INDICES = (
    {"code": "sh000001", "name": "上证指数", "market": "SH", "category": "broad"},
    {"code": "sz399001", "name": "深证成指", "market": "SZ", "category": "broad"},
    {"code": "sh000300", "name": "沪深300", "market": "SH", "category": "broad"},
    {"code": "sh000905", "name": "中证500", "market": "SH", "category": "broad"},
    {"code": "sh000852", "name": "中证1000", "market": "SH", "category": "broad"},
    {"code": "sh000985", "name": "中证全指", "market": "SH", "category": "broad"},
    {"code": "sh000016", "name": "上证50", "market": "SH", "category": "broad"},
    {"code": "sz399006", "name": "创业板指", "market": "SZ", "category": "broad"},
    {"code": "sh000688", "name": "科创50", "market": "SH", "category": "broad"},
    {"code": "sh000015", "name": "红利指数", "market": "SH", "category": "style"},
    {"code": "sh000922", "name": "中证红利", "market": "SH", "category": "style"},
)


def is_main_board_stock(code: str, name: str = "", *, exclude_st: bool = True) -> bool:
    """Return True if the code belongs to Shanghai or Shenzhen main boards."""
    code_str = str(code).zfill(6)
    if not MAIN_BOARD_STOCK_PATTERN.match(code_str):
        return False
    if exclude_st and name and ST_NAME_PATTERN.search(name):
        return False
    return True


def is_etf(code: str) -> bool:
    """Return True if the code belongs to Shanghai or Shenzhen ETFs."""
    code_str = str(code).zfill(6)
    return bool(ETF_PATTERN.match(code_str))


def classify_instrument(code: str, name: str = "") -> str:
    """Classify instrument into 'stock', 'etf', 'index', or 'other'."""
    code_str = str(code).strip()
    if code_str.startswith(("sh", "sz")) or any(idx["code"] == code_str for idx in CORE_INDICES):
        return "index"
    z_code = code_str.zfill(6)
    if is_etf(z_code):
        return "etf"
    if is_main_board_stock(z_code, name, exclude_st=False):
        return "stock"
    return "other"


def filter_universe(
    df: pd.DataFrame,
    *,
    allow_stocks: bool = True,
    allow_etfs: bool = True,
    exclude_st: bool = True,
) -> pd.DataFrame:
    """Filter a dataframe with code and optional name columns by universe rules."""
    if df.empty or "code" not in df.columns:
        return df

    has_name = "name" in df.columns
    mask = []
    for _, row in df.iterrows():
        code = str(row["code"]).zfill(6)
        name = str(row["name"]) if has_name else ""
        if allow_stocks and is_main_board_stock(code, name, exclude_st=exclude_st):
            mask.append(True)
        elif allow_etfs and is_etf(code):
            mask.append(True)
        else:
            mask.append(False)

    return df.loc[mask].reset_index(drop=True)
