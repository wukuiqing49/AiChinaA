from __future__ import annotations

from collections.abc import Callable, Iterable
from datetime import UTC, datetime
from time import sleep

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
        def normalize_exchange_list(frame: pd.DataFrame) -> pd.DataFrame:
            if frame.empty or len(frame.columns) < 2:
                raise ValueError("exchange list is missing code or name columns")
            code_position = next(
                (
                    position
                    for position, column in enumerate(frame.columns)
                    if frame[column].astype(str).str.fullmatch(r"\d{6}").mean() > 0.8
                ),
                None,
            )
            if code_position is None or code_position == len(frame.columns) - 1:
                raise ValueError("exchange list has no recognizable code and name columns")
            output = frame.iloc[:, [code_position, code_position + 1]].copy()
            output.columns = ["code", "name"]
            output["code"] = output["code"].astype(str).str.strip().str.zfill(6)
            return output

        def exchange_lists() -> pd.DataFrame:
            sh_df = normalize_exchange_list(self._call("stock_info_sh_name_code")())
            sz_df = normalize_exchange_list(
                self._call("stock_info_sz_name_code")(symbol="A\u80a1\u5217\u8868")
            )
            return pd.concat((sh_df, sz_df), ignore_index=True).drop_duplicates("code")

        def szse_fallback() -> pd.DataFrame:
            sz_df = self._call("stock_info_sz_name_code")(symbol="A股列表")
            code_col = next((c for c in ("A股代码", "代码", "code") if c in sz_df.columns), None)
            name_col = next((c for c in ("A股简称", "名称", "name") if c in sz_df.columns), None)
            rename_map = {}
            if code_col:
                rename_map[code_col] = "code"
            if name_col:
                rename_map[name_col] = "name"
            return sz_df.rename(columns=rename_map)

        return self._first_success(
            (
                ("akshare/exchanges", exchange_lists),
                ("akshare/eastmoney", self._call("stock_zh_a_spot_em")),
                ("akshare/sina", self._call("stock_zh_a_spot")),
                ("akshare/szse", szse_fallback),
                ("akshare/sina_code_name", self._call("stock_info_a_code_name")),
            )
        )

    def get_etf_list(self) -> pd.DataFrame:
        """Return a normalized ETF code/name universe independent of stock listings."""
        frame = self._first_success(
            (("akshare/eastmoney", self._call("fund_etf_spot_em")),)
        )
        code_position = next(
            (
                position
                for position, column in enumerate(frame.columns)
                if frame[column].astype(str).str.fullmatch(r"\d{6}").mean() > 0.8
            ),
            None,
        )
        if code_position is None or code_position == len(frame.columns) - 1:
            raise ValueError("ETF list has no recognizable code and name columns")
        output = frame.iloc[:, [code_position, code_position + 1]].copy()
        output.columns = ["code", "name"]
        output["code"] = output["code"].astype(str).str.strip().str.zfill(6)
        return output.drop_duplicates("code").reset_index(drop=True)

    def get_daily_quotes(
        self,
        code: str,
        start_date: str,
        end_date: str,
        adjust: str = "",
    ) -> pd.DataFrame:
        tx_symbol = self._to_tx_symbol(code)
        attempts: list[tuple[str, Callable[[], pd.DataFrame]]] = []
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

        def eastmoney() -> pd.DataFrame:
            return self._call("stock_zh_a_hist")(
                symbol=code,
                period="daily",
                start_date=start_date,
                end_date=end_date,
                adjust=adjust,
            )

        attempts.append(("akshare/eastmoney", eastmoney))

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

    def get_etf_quotes(
        self,
        code: str,
        start_date: str,
        end_date: str,
        adjust: str = "",
    ) -> pd.DataFrame:
        def eastmoney() -> pd.DataFrame:
            return self._call("fund_etf_hist_em")(
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
                    lambda: self._call("fund_etf_hist_sina")(
                        symbol=sina_symbol,
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

    def get_individual_fund_flow_rank(self, indicator: str) -> pd.DataFrame:
        """Return the all-market stock money-flow ranking for one lookback window."""
        return self._tag_source(
            self._call("stock_individual_fund_flow_rank")(indicator=indicator),
            "akshare/eastmoney",
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
            for retry in range(3):
                try:
                    return self._tag_source(operation(), source)
                except Exception as error:
                    failures.append(f"{source}: {type(error).__name__}: {error}")
                    if retry < 2:
                        sleep(2**retry)
        raise RuntimeError("All AKShare source attempts failed. " + " | ".join(failures))

    @staticmethod
    def _to_tx_symbol(code: str) -> str | None:
        normalized_code = str(code).zfill(6)
        if normalized_code.startswith(("5", "6")):
            return f"sh{normalized_code}"
        if normalized_code.startswith(("0", "1", "2", "3")):
            return f"sz{normalized_code}"
        return None

    @staticmethod
    def _to_sina_symbol(code: str) -> str | None:
        normalized_code = str(code).zfill(6)
        if normalized_code.startswith(("5", "6")):
            return f"sh{normalized_code}"
        if normalized_code.startswith(("0", "1", "2", "3")):
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
        if "date" not in frame.columns and "trade_date" not in frame.columns:
            raise ValueError("daily quote schema missing columns: date")

        col_map = {"date": "trade_date", "turnover": "turnover_rate"}
        normalized = frame.rename(columns=col_map).copy()
        numeric_columns = (
            "open", "high", "low", "close", "volume", "amount", "turnover_rate", "pct_change"
        )
        for col in numeric_columns:
            if col not in normalized.columns:
                normalized[col] = None
        if "turnover" in frame.columns:
            turnover_rate = pd.to_numeric(normalized["turnover_rate"], errors="coerce")
            normalized["turnover_rate"] = turnover_rate * 100
        if "close" in normalized.columns and normalized["pct_change"].isna().all():
            close = pd.to_numeric(normalized["close"], errors="coerce")
            normalized["pct_change"] = close.pct_change(fill_method=None) * 100
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
