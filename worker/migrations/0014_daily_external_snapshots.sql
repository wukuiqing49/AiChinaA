CREATE TABLE IF NOT EXISTS stock_money_flow_daily (
  code TEXT NOT NULL REFERENCES stock_latest(code),
  data_date TEXT NOT NULL,
  source TEXT NOT NULL,
  main_net_inflow REAL,
  main_net_inflow_pct REAL,
  super_large_net_inflow REAL,
  large_net_inflow REAL,
  medium_net_inflow REAL,
  small_net_inflow REAL,
  main_net_inflow_3d REAL,
  main_net_inflow_5d REAL,
  main_net_inflow_10d REAL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (code, data_date)
);

CREATE INDEX IF NOT EXISTS idx_money_flow_daily_date ON stock_money_flow_daily(data_date, main_net_inflow);

CREATE TABLE IF NOT EXISTS stock_valuation_daily (
  code TEXT NOT NULL REFERENCES stock_latest(code),
  data_date TEXT NOT NULL,
  source TEXT NOT NULL,
  pe_ttm REAL,
  pb REAL,
  total_market_cap REAL,
  float_market_cap REAL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (code, data_date)
);

CREATE INDEX IF NOT EXISTS idx_valuation_daily_date ON stock_valuation_daily(data_date, pe_ttm);
