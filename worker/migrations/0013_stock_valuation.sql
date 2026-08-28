CREATE TABLE IF NOT EXISTS stock_valuation_latest (
  code TEXT PRIMARY KEY REFERENCES stock_latest(code),
  data_date TEXT NOT NULL,
  source TEXT NOT NULL,
  pe_ttm REAL,
  pb REAL,
  total_market_cap REAL,
  float_market_cap REAL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stock_valuation_date ON stock_valuation_latest(data_date, pe_ttm);
