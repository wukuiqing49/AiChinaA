CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  display_name TEXT,
  picture_url TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_latest (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  close REAL,
  score_total REAL,
  data_completeness REAL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watchlist_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  code TEXT NOT NULL REFERENCES stock_latest(code),
  source TEXT NOT NULL CHECK(source IN ('manual', 'recommendation')),
  added_at TEXT NOT NULL,
  observation_trade_date TEXT NOT NULL,
  observation_close REAL NOT NULL,
  UNIQUE(user_id, code)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_items_user_added
  ON watchlist_items(user_id, added_at DESC);

CREATE TABLE IF NOT EXISTS recommendation_snapshots (
  id TEXT PRIMARY KEY,
  trade_date TEXT NOT NULL,
  reference_trade_date TEXT NOT NULL,
  reference_close REAL NOT NULL,
  code TEXT NOT NULL REFERENCES stock_latest(code),
  rank INTEGER NOT NULL,
  score REAL NOT NULL,
  reasons_json TEXT NOT NULL,
  config_version TEXT NOT NULL,
  run_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(trade_date, code, config_version)
);

CREATE INDEX IF NOT EXISTS idx_recommendation_snapshots_date_rank
  ON recommendation_snapshots(trade_date DESC, rank ASC);
