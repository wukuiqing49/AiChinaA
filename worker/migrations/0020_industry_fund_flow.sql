CREATE TABLE IF NOT EXISTS industry_fund_flow_latest (
  industry TEXT PRIMARY KEY,
  data_date TEXT NOT NULL,
  source TEXT NOT NULL,
  inflow_amount REAL NOT NULL,
  outflow_amount REAL NOT NULL,
  net_inflow REAL NOT NULL,
  company_count INTEGER,
  pct_change REAL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_industry_fund_flow_latest_date
  ON industry_fund_flow_latest(data_date, net_inflow);

CREATE TABLE IF NOT EXISTS industry_fund_flow_daily (
  industry TEXT NOT NULL,
  data_date TEXT NOT NULL,
  source TEXT NOT NULL,
  inflow_amount REAL NOT NULL,
  outflow_amount REAL NOT NULL,
  net_inflow REAL NOT NULL,
  company_count INTEGER,
  pct_change REAL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (industry, data_date)
);

CREATE INDEX IF NOT EXISTS idx_industry_fund_flow_daily_date
  ON industry_fund_flow_daily(data_date, net_inflow);
