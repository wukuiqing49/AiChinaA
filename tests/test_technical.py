import pandas as pd
import pytest

from pipeline.calculations.technical import calculate_technical_factors, score_technical_factors


def _quotes(code: str, scale: float = 1.0) -> pd.DataFrame:
    dates = pd.date_range("2025-01-01", periods=80, freq="B")
    close = [(index + 10) * scale for index in range(len(dates))]
    return pd.DataFrame(
        {
            "code": code,
            "trade_date": dates.strftime("%Y-%m-%d"),
            "close": close,
            "volume": [1000 + index * 10 for index in range(len(dates))],
        }
    )


def test_technical_factors_require_forward_adjusted_prices() -> None:
    with pytest.raises(ValueError, match="qfq-adjusted"):
        calculate_technical_factors(_quotes("000001"), price_adjustment="none")


def test_technical_factors_and_scores_preserve_unavailable_dimensions() -> None:
    quotes = pd.concat([_quotes("000001", 1.0), _quotes("000002", 2.0)], ignore_index=True)

    factors = calculate_technical_factors(quotes, price_adjustment="qfq")
    scores = score_technical_factors(factors)
    last = scores.iloc[-1]

    assert factors.loc[factors.index[-1], "ret_20d"] == pytest.approx(20 / 69)
    assert scores["score_valuation"].isna().all()
    assert scores["score_quality"].isna().all()
    assert scores["score_growth"].isna().all()
    assert last["data_completeness"] == 1.0
    assert last["score_total"] == pytest.approx(
        last[["score_trend", "score_momentum", "score_volume_price", "score_risk"]].mean()
    )
    assert 0 <= last["score_total"] <= 100
