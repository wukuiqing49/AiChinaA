from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Protocol

import pandas as pd


@dataclass(frozen=True)
class FetchMetadata:
    source: str
    source_version: str | None
    fetched_at: str
    requested_range: str | None
    row_count: int
    warnings: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class ProviderCapabilities:
    trade_calendar: bool = False
    stock_list: bool = False
    daily_quotes: bool = False
    index_quotes: bool = False
    financial_reports: bool = False
    industry_list: bool = False
    concept_list: bool = False
    industry_fund_flow: bool = False

    def to_dict(self) -> dict[str, bool]:
        return asdict(self)


class StockDataProvider(Protocol):
    name: str

    def capabilities(self) -> ProviderCapabilities: ...

    def get_trade_calendar(self) -> pd.DataFrame: ...

    def get_stock_list(self) -> pd.DataFrame: ...

    def get_daily_quotes(
        self,
        code: str,
        start_date: str,
        end_date: str,
        adjust: str = "",
    ) -> pd.DataFrame: ...

    def get_index_quotes(self, symbol: str) -> pd.DataFrame: ...

    def get_financial_reports(self, code: str, start_year: str) -> pd.DataFrame: ...

    def get_industries(self) -> pd.DataFrame: ...

    def get_concepts(self) -> pd.DataFrame: ...

    def get_industry_fund_flow(self) -> pd.DataFrame: ...
