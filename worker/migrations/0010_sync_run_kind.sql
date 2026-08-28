ALTER TABLE sync_runs ADD COLUMN run_kind TEXT NOT NULL DEFAULT 'full_market'
  CHECK(run_kind IN ('full_market', 'supplemental_st', 'single_stock'));

CREATE INDEX IF NOT EXISTS idx_sync_runs_kind_status_completed
  ON sync_runs(run_kind, status, completed_at DESC);
