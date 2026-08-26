# Phase 0 Verification Status

Updated: 2026-08-26

## Decision

The approved free-tier storage design remains feasible for the first release:

- Cloudflare D1 stores the small, query-heavy current snapshot and job state.
- Cloudflare R2 stores compressed, append-oriented ten-year history.
- GitHub stores source code, configuration, and documentation only. It is not an online database.

## Live Evidence

The provider probe ran for 30 current representative codes over 2016-08-26 through
2026-08-25. It completed all 37 checks and returned 63,500 normalized daily-quote rows.

| Measure | Result |
| --- | ---: |
| Quote coverage | 100% (30 / 30) |
| Average ten-year request | 4.25 seconds |
| Estimated sequential full-universe import | 6.49 hours |
| Estimated four-worker import | 1.62 hours |
| Ten-year rows assumed | 13,420,000 |
| R2 quote-only estimate | 0.45 GiB |
| SQLite quote-only estimate with index | 1.37 GiB |

The R2 figure is derived from a gzip JSON measurement of the 63,500 real rows. It
does not include valuation, score, financial, sector, signal, manifest, or backup
objects, so it is evidence for the quote-history portion rather than final capacity
approval.

Provider sources observed during this run were Sina for calendar, stock list, index,
and Beijing Exchange fallback; Tencent for Shanghai and Shenzhen historical quotes;
and THS for industry, concept, and industry fund-flow data.

The Eastmoney financial-indicator source returned `REPORT_DATE`, `NOTICE_DATE`, and
`UPDATE_DATE` for five live samples spanning Shanghai, Shenzhen, ChiNext, STAR Market,
and Beijing Exchange codes. It is now the primary financial source. The Sina financial
source remains a fallback, but its output does not qualify for historical scoring when
it lacks an announcement date.

An independent recovery benchmark then requested the most recent 20 trade dates
(2026-07-29 through 2026-08-25) for 100 board-diverse codes with four workers. It
returned 1,998 of 2,000 expected rows: 100% code coverage, 99 full-coverage codes,
99.90% row coverage, and a 1.25-second average request time. The only short result was
`000016` with 18 rows, retained as a data-quality warning. The same request shape
projects a five-trade-date, 5,500-code recovery to about 29 minutes at four workers,
below the 90-minute target.

The qfq-adjusted ten-year probe also produced 63,500 real quote rows. From those rows,
the technical-factor archive measured 7.93 MB gzip and the technical-score archive
measured 0.91 MB gzip. Extrapolated to 13,420,000 ten-year rows, the combined technical
archive is 1.74 GiB. Together with the 0.45 GiB quote archive estimate, the declared
R2 history layout projects to 2.19 GiB, below the 8 GiB Gate target.

The available Baidu historical-valuation interface failed its live request, so no
historical valuation objects are emitted. `score_valuation`, `score_quality`, and
`score_growth` remain null in the current technical-score output; they are not zero
and are excluded from `score_total`.

One Beijing Exchange sample (`920000`) contained two invalid OHLC rows. The probe
retained and reported the warning rather than silently correcting it. The ingestion
phase must quarantine invalid rows and record their dates as data-quality gaps.

## Guardrails Added

- The data provider is isolated behind `AkShareProvider`, so source changes have one
  integration boundary.
- Daily quote samples are normalized to a fixed schema before capacity or factor work.
- The probe records source, latency, empty results, and OHLC data-quality warnings.
- Financial data without an announcement-date column is explicitly flagged. Historical
  fundamental scoring is only enabled for the Eastmoney point-in-time source.
- Former NEEQ and delisted-code history is not guaranteed by the free quote sources;
  research based only on listed current codes must disclose survivorship bias.

## Gate 0 Status: Passed With Declared Degradation

The quote-source, announcement-date, recovery, and R2 capacity evidence meet the
initial data gates for the declared V1 scope. The approved degradation is:

1. Historical valuation factors and valuation percentiles are unavailable until a
   reliable point-in-time valuation source is introduced.
2. Scores initially comprise only trend, momentum, volume-price, and risk dimensions.

The next implementation scope is the resumable local ingestion and quality-control
pipeline. It must preserve source, price-adjustment, and data-gap metadata.
