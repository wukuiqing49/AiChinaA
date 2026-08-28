CREATE TABLE IF NOT EXISTS stock_money_flow_latest (
  code TEXT PRIMARY KEY REFERENCES stock_latest(code),
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
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stock_money_flow_data_date
  ON stock_money_flow_latest(data_date, main_net_inflow);
