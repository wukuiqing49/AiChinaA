export interface Env {
  DB: D1Database;
  FIXED_ACCOUNTS: string;
  SESSION_SECRET: string;
  PUBLISH_SECRET: string;
}

export interface SessionUser {
  id: string;
  username: string;
  displayName: string | null;
}

export interface LatestStock {
  code: string;
  name: string;
  trade_date: string;
  close: number | null;
  score_total: number | null;
}
