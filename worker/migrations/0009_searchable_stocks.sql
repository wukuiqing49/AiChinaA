ALTER TABLE stock_latest ADD COLUMN is_st INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_stock_latest_is_st
  ON stock_latest(is_st, updated_at);
