ALTER TABLE stock_latest
  ADD COLUMN instrument_type TEXT NOT NULL DEFAULT 'stock'
  CHECK(instrument_type IN ('stock', 'etf'));

CREATE INDEX IF NOT EXISTS idx_stock_latest_instrument_type
  ON stock_latest(instrument_type, trade_date);

CREATE TABLE IF NOT EXISTS market_index_latest (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  close REAL,
  pct_change REAL,
  ret_20d REAL,
  ma20_slope REAL,
  volatility_20 REAL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_market_index_latest_trade_date
  ON market_index_latest(trade_date DESC);
