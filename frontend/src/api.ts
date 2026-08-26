export interface User {
  username: string;
  displayName: string | null;
}

export interface WatchlistItem {
  code: string;
  name: string;
  source: string;
  addedAt: string;
  observationTradeDate: string;
  observationClose: number;
  latestTradeDate: string;
  latestClose: number | null;
  scoreTotal: number | null;
  tracking: { returnPct: number | null; status: string };
}

export interface Recommendation {
  tradeDate: string;
  referenceTradeDate: string;
  referenceClose: number;
  code: string;
  name: string;
  rank: number;
  score: number;
  reasons: unknown;
  latestTradeDate: string;
  latestClose: number | null;
  tracking: { returnPct: number | null; status: string };
}

export interface ScreenerItem {
  code: string;
  name: string;
  tradeDate: string;
  close: number | null;
  score: number | null;
  dataCompleteness: number | null;
  market: string | null;
  industry: string | null;
  pctChange: number | null;
  turnoverRate: number | null;
  ret5d: number | null;
  ret20d: number | null;
  ret60d: number | null;
  ma20Slope: number | null;
  volumeRatio20: number | null;
  volatility20: number | null;
}

export interface ScreenerQuery {
  code?: string;
  name?: string;
  market?: string;
  industry?: string;
  minPrice?: string;
  maxPrice?: string;
  minRet20?: string;
  maxRet20?: string;
  minTurnover?: string;
  maxVolatility?: string;
  minScore?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDirection?: string;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "include", ...options });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Request failed.");
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export const api = {
  me: () => request<{ user: User }>("/api/me"),
  screener: (query: ScreenerQuery = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") params.set(key, String(value));
    }
    return request<{ items: ScreenerItem[]; total: number; page: number; pageSize: number; asOf: string | null }>(`/api/screener?${params}`);
  },
  login: (username: string, password: string) => request<{ user: User }>("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  watchlist: () => request<{ items: WatchlistItem[] }>("/api/watchlist"),
  addWatchlist: (code: string) => request("/api/watchlist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  }),
  removeWatchlist: (code: string) => request<void>(`/api/watchlist/${code}`, { method: "DELETE" }),
  recommendations: () => request<{ items: Recommendation[] }>("/api/recommendations/tracking"),
};
