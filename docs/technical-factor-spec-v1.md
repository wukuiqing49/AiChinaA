# Technical Factor Specification V1

Status: frozen after Phase 0 live-data verification on 2026-08-26.

## Price Basis

- Display candlesticks use unadjusted OHLC prices.
- Technical factors use only `qfq` (forward-adjusted) close prices.
- A factor calculation rejects any other adjustment label.
- The price-adjustment value belongs in the archive object metadata for every run.

## Factor Windows

| Factor | Definition | Minimum observations |
| --- | --- | ---: |
| `ret_{n}d` | `close / close[n days ago] - 1`, for 5, 20, 60, 120, and 250 | n + 1 |
| `ma{n}` | rolling mean close, for 5, 20, 60, 120, and 250 | n |
| `ma20_slope` | `ma20 / ma20[5 days ago] - 1` | 25 |
| `rsi14` | simple rolling 14-day gain/loss RSI | 15 |
| `volume_ratio_{n}` | volume / rolling mean volume, for 5 and 20 | n |
| `distance_high_{n}` | close / rolling n-day high - 1, for 20, 60, and 250 | n |
| `distance_low_250` | close / rolling 250-day low - 1 | 250 |
| `price_percentile_250` | percentile rank of close in the rolling 250-day window | 250 |
| `volatility_{n}` | rolling standard deviation of daily returns times sqrt(252), for 20 and 60 | n + 1 |
| `max_drawdown_60` | minimum rolling 60-day close-to-running-high drawdown | 119 |

Insufficient history produces `null`, never a zero substitute.

## Cross-Sectional Scores

Scores are calculated independently for each trade date using average-rank percentiles
from 0 to 100. A one-stock valid cross section receives 50.

| Score | Source factor | Direction |
| --- | --- | --- |
| `score_trend` | `ma20_slope` | higher is better |
| `score_momentum` | `ret_20d` | higher is better |
| `score_volume_price` | `volume_ratio_20` | higher is better |
| `score_risk` | `volatility_20` | lower is better |

`score_total` is the mean of the available technical scores. `data_completeness` is the
share of those four scores that is present. `score_valuation`, `score_quality`, and
`score_growth` are explicitly `null` until their validated input datasets exist.

Configuration version: `technical-v1`.

## Technical score V2

The displayed total is a **technical relative-strength score**, not a buy prediction.
Trend and 20-day momentum are cross-sectional percentile scores.  Volume health peaks
near a 20-day volume ratio of 1.5 rather than rewarding unlimited volume; risk health
peaks near 32% annualized 20-day volatility rather than rewarding the lowest volatility.
Money flow, valuation, financial quality, and event data remain explicit rule conditions
until each source has enough history for a separately validated strategy score.
