from __future__ import annotations

import pandas as pd

REQUIRED_QUOTE_COLUMNS = {
    "code",
    "trade_date",
    "close",
    "volume",
}


def calculate_technical_factors(
    quotes: pd.DataFrame,
    *,
    price_adjustment: str,
) -> pd.DataFrame:
    """Calculate technical factors from a single, forward-adjusted price series."""
    if price_adjustment != "qfq":
        raise ValueError("technical factors require qfq-adjusted prices")
    missing = sorted(REQUIRED_QUOTE_COLUMNS.difference(quotes.columns))
    if missing:
        raise ValueError(f"quote data missing columns: {', '.join(missing)}")

    frames = [_calculate_one_code(frame) for _, frame in quotes.groupby("code", sort=True)]
    if not frames:
        return pd.DataFrame(columns=["code", "trade_date"])
    return pd.concat(frames, ignore_index=True)


def score_technical_factors(factors: pd.DataFrame) -> pd.DataFrame:
    required = {"code", "trade_date", "ma20_slope", "ret_20d", "volume_ratio_20", "volatility_20"}
    missing = sorted(required.difference(factors.columns))
    if missing:
        raise ValueError(f"technical factor data missing columns: {', '.join(missing)}")

    dimensions = {
        "score_trend": ("ma20_slope", True),
        "score_momentum": ("ret_20d", True),
        "score_volume_price": ("volume_ratio_20", True),
        "score_risk": ("volatility_20", False),
    }
    output = factors.loc[:, ["code", "trade_date"]].copy()
    for score_column, (factor_column, higher_is_better) in dimensions.items():
        grouped = factors.groupby("trade_date", group_keys=False)[factor_column]
        output[score_column] = grouped.transform(
            lambda values: _percentile_score(values, higher_is_better)
        )

    output["score_valuation"] = None
    output["score_quality"] = None
    output["score_growth"] = None
    technical_scores = list(dimensions)
    output["score_total"] = output[technical_scores].mean(axis=1, skipna=True)
    output["data_completeness"] = (
        output[technical_scores].notna().sum(axis=1) / len(technical_scores)
    )
    return output


def _calculate_one_code(frame: pd.DataFrame) -> pd.DataFrame:
    ordered = frame.sort_values("trade_date").copy()
    if ordered["trade_date"].duplicated().any():
        raise ValueError(f"duplicate trade dates for {ordered['code'].iloc[0]}")

    close = pd.to_numeric(ordered["close"], errors="coerce")
    volume = pd.to_numeric(ordered["volume"], errors="coerce")
    returns = close.pct_change()
    output = ordered.loc[:, ["code", "trade_date"]].copy()
    for days in (5, 20, 60, 120, 250):
        output[f"ret_{days}d"] = close.pct_change(days)
        moving_average = close.rolling(days, min_periods=days).mean()
        output[f"ma{days}"] = moving_average
    output["ma20_slope"] = output["ma20"].pct_change(5)
    output["rsi14"] = _rsi(close, 14)
    output["volume_ratio_5"] = volume / volume.rolling(5, min_periods=5).mean()
    output["volume_ratio_20"] = volume / volume.rolling(20, min_periods=20).mean()
    output["distance_high_20"] = close / close.rolling(20, min_periods=20).max() - 1
    output["distance_high_60"] = close / close.rolling(60, min_periods=60).max() - 1
    output["distance_high_250"] = close / close.rolling(250, min_periods=250).max() - 1
    output["distance_low_250"] = close / close.rolling(250, min_periods=250).min() - 1
    output["price_percentile_250"] = close.rolling(250, min_periods=250).rank(pct=True)
    output["volatility_20"] = returns.rolling(20, min_periods=20).std() * (252**0.5)
    output["volatility_60"] = returns.rolling(60, min_periods=60).std() * (252**0.5)
    rolling_high = close.rolling(60, min_periods=60).max()
    drawdown = close / rolling_high - 1
    output["max_drawdown_60"] = drawdown.rolling(60, min_periods=60).min()
    return output


def _rsi(close: pd.Series, days: int) -> pd.Series:
    changes = close.diff()
    gains = changes.clip(lower=0).rolling(days, min_periods=days).mean()
    losses = (-changes.clip(upper=0)).rolling(days, min_periods=days).mean()
    relative_strength = gains / losses
    return 100 - 100 / (1 + relative_strength)


def _percentile_score(values: pd.Series, higher_is_better: bool) -> pd.Series:
    valid = values.dropna()
    result = pd.Series(float("nan"), index=values.index, dtype="float64")
    if valid.empty:
        return result
    if len(valid) == 1:
        result.loc[valid.index] = 50.0
        return result
    ranks = (valid.rank(method="average") - 1) / (len(valid) - 1) * 100
    result.loc[valid.index] = ranks if higher_is_better else 100 - ranks
    return result
