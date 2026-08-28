CREATE TABLE IF NOT EXISTS data_refresh_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed')),
  requested_by TEXT,
  requested_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  trade_date TEXT,
  row_count INTEGER,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_data_refresh_runs_requested_at
  ON data_refresh_runs(requested_at DESC);
