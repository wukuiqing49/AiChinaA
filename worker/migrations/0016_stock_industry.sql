-- A stable classification dimension.  It is deliberately kept separate from
-- stock_screen_latest: a daily technical-score publish must not erase an
-- industry mapping that is refreshed on a different cadence.
CREATE TABLE IF NOT EXISTS stock_industry_latest (
  code TEXT PRIMARY KEY REFERENCES stock_latest(code),
  industry TEXT NOT NULL,
  source TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stock_industry_industry
  ON stock_industry_latest(industry);
