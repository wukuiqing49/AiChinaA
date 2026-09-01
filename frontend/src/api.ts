export interface User {
  username: string;
  displayName: string | null;
  isAdmin: boolean;
}

export interface DataRefresh {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  requestedBy: string | null;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  tradeDate: string | null;
  rowCount: number | null;
  error: string | null;
}

export interface DataStatus {
  quoteUpdatedAt: string | null;
  industryFundFlowUpdatedAt: string | null;
  stockMoneyFlowUpdatedAt: string | null;
  valuationUpdatedAt: string | null;
  financialUpdatedAt: string | null;
  screenerUpdatedAt: string | null;
  screenerTradeDate: string | null;
}

export interface MarketOverview {
  totalCount: number;
  upCount: number;
  downCount: number;
  flatCount: number;
  ret20AvailableCount: number;
  averageRet20: number | null;
  averageScore: number | null;
  highScoreCount: number;
  asOf: string | null;
}

export interface RuleDataCapabilities {
  industry: boolean;
  moneyFlow: boolean;
  valuation: boolean;
  financial: boolean;
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
  instrumentType: "stock" | "etf";
  isSt: boolean;
  tradeDate: string;
  quoteDate: string | null;
  quoteTime: string | null;
  quoteSource: "tencent" | "sina" | null;
  close: number | null;
  score: number | null;
  scoreTrend: number | null;
  scoreMomentum: number | null;
  scoreVolumePrice: number | null;
  scoreRisk: number | null;
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
  totalMarketCap?: number | null;
  floatMarketCap?: number | null;
}

export interface MarketIndexItem {
  code: string;
  name: string;
  tradeDate: string;
  quoteDate: string | null;
  quoteTime: string | null;
  quoteSource: "tencent" | "sina" | null;
  close: number | null;
  pctChange: number | null;
  ret20d: number | null;
  ma20Slope: number | null;
  volatility20: number | null;
}

export interface ScreenerQuery {
  code?: string;
  name?: string;
  instrumentType?: "stock" | "etf" | "";
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

export interface RuleCondition {
  field: "ret5d" | "ret20d" | "ret60d" | "ret120d" | "ret250d" | "ma20Slope" | "volumeRatio5" | "volumeRatio20" | "amount" | "amountRatio5" | "amountRatio20" | "rsi14" | "volatility20" | "volatility60" | "maxDrawdown60" | "distanceHigh20" | "distanceHigh60" | "distanceHigh250" | "distanceLow250" | "pricePercentile250" | "turnoverRate" | "close" | "score" | "mainNetInflow" | "mainNetInflowPct" | "superLargeNetInflow" | "largeNetInflow" | "mediumNetInflow" | "smallNetInflow" | "mainNetInflow3d" | "mainNetInflow5d" | "mainNetInflow10d" | "peTtm" | "pb" | "totalMarketCap" | "floatMarketCap" | "roe" | "revenueYoy" | "profitYoy" | "grossMargin" | "debtRatio" | "revenue" | "netProfit" | "industry" | "market";
  op: ">" | ">=" | "<" | "<=" | "==" | "!=" | "contains";
  value: number | string;
}

export interface RuleScreenerRequest {
  logic: "AND" | "OR";
  conditions: RuleCondition[];
  excludeSt: boolean;
  sortBy: "score" | "price" | "ret20" | "turnover" | "volatility";
  sortDirection: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface SectorHeatmapItem {
  industry: string;
  dataDate: string;
  inflowAmount: number;
  outflowAmount: number;
  netInflow: number;
  companyCount: number | null;
  pctChange: number | null;
  updatedAt: string;
}

export interface SavedStrategy {
  id: string;
  name: string;
  rule: RuleScreenerRequest;
  createdAt: string;
  updatedAt: string;
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
  marketIndices: () => request<{ items: MarketIndexItem[] }>("/api/market-indices"),
  marketOverview: () => request<MarketOverview>("/api/market-overview"),
  marketHeatmap: () => request<{ items: SectorHeatmapItem[]; asOf: string | null; updatedAt: string | null; moneyFlowAvailable: boolean }>("/api/market-heatmap"),
  top10: () => request<{ items: ScreenerItem[] }>("/api/recommendations/top10"),
  ruleDataCapabilities: () => request<RuleDataCapabilities>("/api/rule-data-capabilities"),
  ruleScreener: (rule: RuleScreenerRequest) => request<{ items: ScreenerItem[]; total: number; page: number; pageSize: number }>("/api/rule-screener", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rule),
  }),
  dataRefresh: () => request<{ refresh: DataRefresh | null }>("/api/data-refresh"),
  dataStatus: () => request<DataStatus>("/api/data-status"),
  requestDataRefresh: () => request<{ refresh: DataRefresh }>("/api/data-refresh", { method: "POST" }),
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
  savedStrategies: () => request<{ items: SavedStrategy[] }>("/api/saved-strategies"),
  saveStrategy: (name: string, rule: RuleScreenerRequest) => request<{ item: SavedStrategy }>("/api/saved-strategies", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, rule }),
  }),
  removeStrategy: (id: string) => request<void>(`/api/saved-strategies/${id}`, { method: "DELETE" }),
  recommendations: () => request<{ items: Recommendation[] }>("/api/recommendations/tracking"),
};
