from __future__ import annotations

from collections.abc import Callable, Iterable
from datetime import UTC, datetime

import pandas as pd

from pipeline.providers.base import ProviderCapabilities


class AkShareProvider:
    """Isolate AKShare calls and normalize only the daily quote columns used by Phase 0."""

    name = "akshare"

    def __init__(self, client: object | None = None) -> None:
        if client is None:
            import akshare as ak

            client = ak
        self._client = client

    def capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            trade_calendar=True,
            stock_list=True,
            daily_quotes=True,
            index_quotes=True,
            financial_reports=True,
            industry_list=True,
            concept_list=True,
            industry_fund_flow=True,
        )

    def get_trade_calendar(self) -> pd.DataFrame:
        return self._tag_source(self._call("tool_trade_date_hist_sina")(), "akshare/sina")

    def get_stock_list(self) -> pd.DataFrame:
        return self._first_success(
            (
                ("akshare/eastmoney", self._call("stock_zh_a_spot_em")),
                ("akshare/sina", self._call("stock_info_a_code_name")),
            )
        )

    def get_daily_quotes(
        self,
        code: str,
        start_date: str,
        end_date: str,
        adjust: str = "",
    ) -> pd.DataFrame:
        def eastmoney() -> pd.DataFrame:
            return self._call("stock_zh_a_hist")(
                symbol=code,
                period="daily",
                start_date=start_date,
                end_date=end_date,
                adjust=adjust,
            )

        tx_symbol = self._to_tx_symbol(code)
        attempts: list[tuple[str, Callable[[], pd.DataFrame]]] = [("akshare/eastmoney", eastmoney)]
        if tx_symbol is not None:
            attempts.append(
                (
                    "akshare/tencent",
                    lambda: self._call("stock_zh_a_hist_tx")(
                        symbol=tx_symbol,
                        start_date=start_date,
                        end_date=end_date,
                        adjust=adjust,
                    ),
                )
            )
        sina_symbol = self._to_sina_symbol(code)
        if sina_symbol is not None:
            attempts.append(
                (
                    "akshare/sina",
                    lambda: self._call("stock_zh_a_daily")(
                        symbol=sina_symbol,
                        start_date=start_date,
                        end_date=end_date,
                        adjust=adjust,
                    ),
                )
            )
        frame = self._first_success(attempts)
        frame.attrs["price_adjustment"] = adjust or "none"
        return frame

    def get_index_quotes(self, symbol: str) -> pd.DataFrame:
        return self._first_success(
            (
                ("akshare/eastmoney", lambda: self._call("stock_zh_index_daily_em")(symbol=symbol)),
                ("akshare/sina", lambda: self._call("stock_zh_index_daily")(symbol=symbol)),
            )
        )

    def get_financial_reports(self, code: str, start_year: str) -> pd.DataFrame:
        symbol = self._to_eastmoney_symbol(code)

        def eastmoney() -> pd.DataFrame:
            frame = self._call("stock_financial_analysis_indicator_em")(symbol=symbol)
            report_date = pd.to_datetime(frame["REPORT_DATE"], errors="coerce")
            return frame.loc[report_date.dt.year >= int(start_year)].copy()

        return self._first_success(
            (
                ("akshare/eastmoney", eastmoney),
                (
                    "akshare/sina",
                    lambda: self._call("stock_financial_analysis_indicator")(
                        symbol=code,
                        start_year=start_year,
                    ),
                ),
            )
        )

    def get_industries(self) -> pd.DataFrame:
        return self._first_success(
            (
                ("akshare/eastmoney", self._call("stock_board_industry_name_em")),
                ("akshare/ths", self._call("stock_board_industry_name_ths")),
            )
        )

    def get_concepts(self) -> pd.DataFrame:
        return self._first_success(
            (
                ("akshare/eastmoney", self._call("stock_board_concept_name_em")),
                ("akshare/ths", self._call("stock_board_concept_name_ths")),
            )
        )

    def get_industry_fund_flow(self) -> pd.DataFrame:
        return self._tag_source(
            self._call("stock_fund_flow_industry")(symbol="即时"),
            "akshare/ths",
        )

    def normalize_daily_quotes(self, frame: pd.DataFrame, code: str) -> pd.DataFrame:
        required_columns = {
            "日期": "trade_date",
            "开盘": "open",
            "最高": "high",
            "最低": "low",
            "收盘": "close",
            "成交量": "volume",
            "成交额": "amount",
            "涨跌幅": "pct_change",
            "换手率": "turnover_rate",
        }
        if all(source in frame.columns for source in required_columns):
            normalized = frame.loc[:, required_columns.keys()]
            normalized = normalized.rename(columns=required_columns).copy()
        else:
            normalized = self._normalize_tencent_daily_quotes(frame)
        normalized.insert(0, "code", str(code).zfill(6))
        normalized["trade_date"] = pd.to_datetime(normalized["trade_date"]).dt.strftime("%Y-%m-%d")
        for column in normalized.columns:
            if column not in {"code", "trade_date"}:
                normalized[column] = pd.to_numeric(normalized[column], errors="coerce")
        normalized.attrs["source"] = frame.attrs.get("source", "akshare/unknown")
        normalized.attrs["price_adjustment"] = frame.attrs.get("price_adjustment", "unknown")
        return normalized

    @staticmethod
    def metadata(row_count: int, requested_range: str | None = None) -> dict[str, object]:
        return {
            "source": "akshare",
            "source_version": None,
            "fetched_at": datetime.now(UTC).isoformat(),
            "requested_range": requested_range,
            "row_count": row_count,
        }

    def _call(self, name: str) -> Callable[..., pd.DataFrame]:
        method = getattr(self._client, name, None)
        if method is None:
            raise RuntimeError(f"AKShare function unavailable: {name}")
        return method

    @staticmethod
    def _tag_source(frame: pd.DataFrame, source: str) -> pd.DataFrame:
        frame.attrs["source"] = source
        return frame

    def _first_success(
        self,
        attempts: Iterable[tuple[str, Callable[[], pd.DataFrame]]],
    ) -> pd.DataFrame:
        failures: list[str] = []
        for source, operation in attempts:
            try:
                return self._tag_source(operation(), source)
            except Exception as error:
                failures.append(f"{source}: {type(error).__name__}: {error}")
        raise RuntimeError("All AKShare source attempts failed. " + " | ".join(failures))

    @staticmethod
    def _to_tx_symbol(code: str) -> str | None:
        normalized_code = str(code).zfill(6)
        if normalized_code.startswith("6"):
            return f"sh{normalized_code}"
        if normalized_code.startswith(("0", "2", "3")):
            return f"sz{normalized_code}"
        return None

    @staticmethod
    def _to_sina_symbol(code: str) -> str | None:
        normalized_code = str(code).zfill(6)
        if normalized_code.startswith("6"):
            return f"sh{normalized_code}"
        if normalized_code.startswith(("0", "2", "3")):
            return f"sz{normalized_code}"
        if normalized_code.startswith(("4", "8", "9")):
            return f"bj{normalized_code}"
        return None

    @staticmethod
    def _to_eastmoney_symbol(code: str) -> str:
        normalized_code = str(code).zfill(6)
        if normalized_code.startswith("6"):
            return f"{normalized_code}.SH"
        if normalized_code.startswith(("0", "2", "3")):
            return f"{normalized_code}.SZ"
        if normalized_code.startswith(("4", "8", "9")):
            return f"{normalized_code}.BJ"
        raise ValueError(f"Unsupported A-share code: {code}")

    @staticmethod
    def _normalize_tencent_daily_quotes(frame: pd.DataFrame) -> pd.DataFrame:
        required_columns = {"date", "open", "high", "low", "close", "volume", "amount", "turnover"}
        missing = sorted(required_columns.difference(frame.columns))
        if missing:
            raise ValueError(f"daily quote schema missing columns: {', '.join(missing)}")

        source_columns = [
            "date",
            "open",
            "high",
            "low",
            "close",
            "volume",
            "amount",
            "turnover",
        ]
        normalized = frame.loc[:, source_columns].copy()
        normalized = normalized.rename(columns={"date": "trade_date", "turnover": "turnover_rate"})
        turnover_rate = pd.to_numeric(normalized["turnover_rate"], errors="coerce")
        normalized["turnover_rate"] = turnover_rate * 100
        close = pd.to_numeric(normalized["close"], errors="coerce")
        normalized["pct_change"] = close.pct_change() * 100
        output_columns = [
            "trade_date",
            "open",
            "high",
            "low",
            "close",
            "volume",
            "amount",
            "pct_change",
            "turnover_rate",
        ]
        return normalized[output_columns]
