CREATE TABLE IF NOT EXISTS stock_financial_latest (
  code TEXT PRIMARY KEY REFERENCES stock_latest(code), report_date TEXT NOT NULL, announcement_date TEXT,
  source TEXT NOT NULL, roe REAL, revenue_yoy REAL, profit_yoy REAL, gross_margin REAL, debt_ratio REAL,
  revenue REAL, net_profit REAL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stock_financial_daily (
  code TEXT NOT NULL REFERENCES stock_latest(code), data_date TEXT NOT NULL, report_date TEXT NOT NULL, announcement_date TEXT,
  source TEXT NOT NULL, roe REAL, revenue_yoy REAL, profit_yoy REAL, gross_margin REAL, debt_ratio REAL,
  revenue REAL, net_profit REAL, fetched_at TEXT NOT NULL, PRIMARY KEY (code, data_date, report_date)
);
CREATE INDEX IF NOT EXISTS idx_financial_daily_report ON stock_financial_daily(report_date, code);
