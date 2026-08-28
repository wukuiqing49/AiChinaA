ALTER TABLE stock_latest ADD COLUMN quote_date TEXT;
ALTER TABLE stock_latest ADD COLUMN quote_time TEXT;

ALTER TABLE market_index_latest ADD COLUMN quote_date TEXT;
ALTER TABLE market_index_latest ADD COLUMN quote_time TEXT;

CREATE INDEX IF NOT EXISTS idx_stock_latest_quote_date
  ON stock_latest(quote_date DESC);

CREATE INDEX IF NOT EXISTS idx_market_index_latest_quote_date
  ON market_index_latest(quote_date DESC);
