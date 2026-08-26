CREATE TABLE IF NOT EXISTS stock_screen_latest (
  code TEXT PRIMARY KEY REFERENCES stock_latest(code),
  trade_date TEXT NOT NULL,
  market TEXT,
  industry TEXT,
  pct_change REAL,
  turnover_rate REAL,
  ret_5d REAL,
  ret_20d REAL,
  ret_60d REAL,
  ma20_slope REAL,
  volume_ratio_20 REAL,
  volatility_20 REAL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stock_screen_market_industry
  ON stock_screen_latest(market, industry);

CREATE INDEX IF NOT EXISTS idx_stock_screen_trade_score
  ON stock_screen_latest(trade_date, code);
