import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hierarchy, treemap } from "d3-hierarchy";

import { api, DataRefresh, DataStatus, MarketIndexItem, MarketOverview, Recommendation, RuleCondition, RuleDataCapabilities, RuleScreenerRequest, SavedStrategy, ScreenerItem, ScreenerQuery, SectorHeatmapItem, User, WatchlistItem } from "./api";
import "./styles.css";
import { formatNumber,formatPercent,formatRatioPercent,marketDate } from "./formatters";
import StockDetailPage from "./components/StockDetailPage";
import RecommendationsView from "./components/RecommendationsView";
import { ApiError } from "./api";
import { downloadCsv } from "./csv";

type FilterState = Omit<ScreenerQuery, "page" | "pageSize">;
type NavTab = "screener" | "heatmap" | "recommendations" | "rules" | "watchlist";

const emptyFilters: FilterState = {
  code: "",
  name: "",
  instrumentType: "",
  market: "",
  industry: "",
  minPrice: "",
  maxPrice: "",
  minRet20: "",
  maxRet20: "",
  minTurnover: "",
  maxVolatility: "",
  minScore: "",
  sortBy: "score",
  sortDirection: "desc",
};

const TECHNICAL_RULE_PRESETS: Array<{ label: string; conditions: RuleCondition[] }> = [
  {
    label: "趋势突破",
    conditions: [
      { field: "ret20d", op: ">=", value: 0.08 },
      { field: "ma20Slope", op: ">=", value: 0.01 },
      { field: "volumeRatio20", op: ">=", value: 1.2 },
      { field: "rsi14", op: ">=", value: 55 },
      { field: "rsi14", op: "<=", value: 75 },
      { field: "score", op: ">=", value: 70 },
    ],
  },
  {
    label: "回踩上升趋势",
    conditions: [
      { field: "ret60d", op: ">=", value: 0.12 },
      { field: "ma20Slope", op: ">=", value: 0.005 },
      { field: "distanceHigh20", op: ">=", value: -0.06 },
      { field: "rsi14", op: ">=", value: 45 },
      { field: "rsi14", op: "<=", value: 62 },
      { field: "score", op: ">=", value: 65 },
    ],
  },
  {
    label: "低波动趋势",
    conditions: [
      { field: "ret20d", op: ">=", value: 0.03 },
      { field: "ma20Slope", op: ">=", value: 0 },
      { field: "volatility20", op: "<=", value: 0.28 },
      { field: "maxDrawdown60", op: ">=", value: -0.15 },
      { field: "score", op: ">=", value: 65 },
    ],
  },
  {
    label: "放量启动",
    conditions: [
      { field: "ret5d", op: ">=", value: 0.02 },
      { field: "volumeRatio5", op: ">=", value: 1.2 },
      { field: "amountRatio5", op: ">=", value: 1.15 },
      { field: "ma20Slope", op: ">=", value: 0 },
      { field: "rsi14", op: ">=", value: 50 },
      { field: "rsi14", op: "<=", value: 70 },
    ],
  },
  {
    label: "中期强势",
    conditions: [
      { field: "ret60d", op: ">=", value: 0.2 },
      { field: "ret20d", op: ">=", value: 0.05 },
      { field: "pricePercentile250", op: ">=", value: 0.7 },
      { field: "distanceHigh60", op: ">=", value: -0.08 },
      { field: "score", op: ">=", value: 75 },
    ],
  },
];

const OPTIONAL_RULE_FIELD_CAPABILITIES: Partial<Record<RuleCondition["field"], keyof RuleDataCapabilities>> = {
  industry: "industry",
  mainNetInflow: "moneyFlow",
  mainNetInflowPct: "moneyFlow",
  superLargeNetInflow: "moneyFlow",
  largeNetInflow: "moneyFlow",
  mediumNetInflow: "moneyFlow",
  smallNetInflow: "moneyFlow",
  mainNetInflow3d: "moneyFlow",
  mainNetInflow5d: "moneyFlow",
  mainNetInflow10d: "moneyFlow",
  peTtm: "valuation",
  pb: "valuation",
  totalMarketCap: "valuation",
  floatMarketCap: "valuation",
  roe: "financial",
  revenueYoy: "financial",
  profitYoy: "financial",
  grossMargin: "financial",
  debtRatio: "financial",
  revenue: "financial",
  netProfit: "financial",
};

function exportToCsv(items: ScreenerItem[], filename = "量化选股数据（当前页）.csv") {
  downloadCsv(["代码", "名称", "市场", "行业", "最新价", "20日涨跌幅(%)", "换手率(%)", "20日年化波动率(%)", "综合得分", "报价日期", "因子日期"],
    items.map((item) => [`\t${item.code}`, item.name, item.market, item.industry, item.close,
      item.ret20d === null ? null : item.ret20d * 100, item.turnoverRate,
      item.volatility20 === null ? null : item.volatility20 * 100, item.score, marketDate(item), item.tradeDate]), filename);
}

function MarketIndexOverview({ items }: { items: MarketIndexItem[] }) {
  if (!items.length) return null;
  const newestTradeDate = items.reduce(
    (latest, item) => (marketDate(item) > latest ? marketDate(item) : latest),
    marketDate(items[0]),
  );
  const staleThreshold = new Date(`${newestTradeDate}T00:00:00Z`).getTime() - 3 * 24 * 60 * 60 * 1000;
  return (
    <section className="market-index-overview" aria-label="Market indices">
      <div className="market-index-heading">
        <h2>Market indices</h2>
        <span>Benchmark performance</span>
      </div>
      <div className="market-index-grid">
        {items.map((item) => {
          const displayDate = marketDate(item);
          const isStale = new Date(`${displayDate}T00:00:00Z`).getTime() < staleThreshold;
          const isHistoryStale = new Date(`${item.tradeDate}T00:00:00Z`).getTime() < staleThreshold;
          return <div key={item.code} className="market-index-card">
            <span className="market-index-name">{item.name}</span>
            <strong>{formatNumber(item.close)}</strong>
            <span className={item.pctChange !== null && item.pctChange < 0 ? "negative" : "positive"}>
              {formatPercent(item.pctChange)}
            </span>
            <small>20d {formatRatioPercent(item.ret20d)}</small>
            <small className={isStale || isHistoryStale ? "index-date stale" : "index-date"} title={`Historical factors: ${item.tradeDate}`}>
              As of {displayDate}{item.quoteTime ? ` ${item.quoteTime}` : ""}{isStale ? " (quote stale)" : ""}{isHistoryStale ? ` (history ${item.tradeDate} stale)` : ""}
            </small>
          </div>;
        })}
      </div>
    </section>
  );
}

export default function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    return (localStorage.getItem("theme") as "light" | "dark") || "light";
  });
  const [user, setUser] = useState<User | null>(null);
  const [navTab, setNavTab] = useState<NavTab>(() => (
    window.location.pathname === "/heatmap" ? "heatmap" : "screener"
  ));
  const [categoryTab, setCategoryTab] = useState<"all" | "stocks" | "etfs">("all");
  
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [marketIndices, setMarketIndices] = useState<MarketIndexItem[]>([]);
  const [marketOverview, setMarketOverview] = useState<MarketOverview | null>(null);
  const [refresh, setRefresh] = useState<DataRefresh | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [dataStatus, setDataStatus] = useState<DataStatus | null>(null);
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [items, setItems] = useState<ScreenerItem[]>([]);
  const [marketHeatmap, setMarketHeatmap] = useState<{
    items: SectorHeatmapItem[];
    asOf: string | null;
    updatedAt: string | null;
    moneyFlowAvailable: boolean;
  }>({ items: [], asOf: null, updatedAt: null, moneyFlowAvailable: false });
  const [top10Items, setTop10Items] = useState<ScreenerItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [asOf, setAsOf] = useState<string | null>(null);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [selectedStock, setSelectedStock] = useState<ScreenerItem | null>(null);
  const [isFullScreenDetail, setIsFullScreenDetail] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState("");

  const navigateToTab = useCallback((tab: NavTab) => {
    const path = tab === "heatmap" ? "/heatmap" : "/";
    if (window.location.pathname !== path) window.history.pushState(null, "", path);
    setNavTab(tab);
  }, []);

  useEffect(() => {
    const syncTabWithLocation = () => {
      setNavTab(window.location.pathname === "/heatmap" ? "heatmap" : "screener");
    };
    window.addEventListener("popstate", syncTabWithLocation);
    return () => window.removeEventListener("popstate", syncTabWithLocation);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "light" ? "dark" : "light";
      localStorage.setItem("theme", next);
      return next;
    });
  }, []);

  const loadUser = useCallback(async () => {
    try {
      const me = await api.me();
      setUser(me.user);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) { setUser(null); setWatchlist([]); }
      else setError("登录状态加载失败，请稍后重试。");
      return;
    }
    try { const list = await api.watchlist(); setWatchlist(list.items); }
    catch { setError("自选数据暂时无法加载，已保留当前列表。"); }
  }, []);

  const loadRecommendations = useCallback(async () => {
    try {
      const res = await api.recommendations();
      setRecommendations(res.items);
    } catch { setError("推荐跟踪暂时无法加载。"); }
  }, []);

  const loadMarketIndices = useCallback(async () => {
    try {
      const result = await api.marketIndices();
      setMarketIndices(result.items);
    } catch { setError("指数数据暂时无法加载。"); }
  }, []);

  const loadRefresh = useCallback(async () => {
    try {
      const result = await api.dataRefresh();
      setRefresh(result.refresh);
    } catch {
      setRefresh(null);
    }
  }, []);

  async function requestRefresh() {
    setRefreshError(null);
    try {
      const result = await api.requestDataRefresh();
      setRefresh(result.refresh);
    } catch (requestError) {
      setRefreshError(requestError instanceof Error ? requestError.message : "更新请求失败。");
    }
  }

  const screenRequest = useRef(0);
  const screenSnapshot = useRef<string | null>(null);
  const loadScreen = useCallback(async (nextFilters: FilterState, nextPage: number) => {
    const requestId = ++screenRequest.current;
    setLoading(true);
    try {
      const result = await api.screener({ ...nextFilters, page: nextPage, pageSize: 25, snapshotId: nextPage > 1 ? screenSnapshot.current ?? undefined : undefined });
      if (requestId !== screenRequest.current) return;
      screenSnapshot.current = result.snapshotId;
      setItems(result.items);
      setTotal(result.total);
      setPage(result.page);
      setAsOf(result.asOf);
      setError(null);
    } catch (requestError) {
      if (requestId === screenRequest.current) setError(requestError instanceof Error ? requestError.message : "筛选数据加载失败。");
    } finally {
      if (requestId === screenRequest.current) setLoading(false);
    }
  }, []);

  const loadMarketHeatmap = useCallback(async () => {
    try {
      const result = await api.marketHeatmap();
      setMarketHeatmap(result);
    } catch { setError("行业资金数据暂时无法加载。"); }
  }, []);

  const loadMarketOverview = useCallback(async () => {
    try {
      setMarketOverview(await api.marketOverview());
    } catch {
      setMarketOverview(null);
    }
  }, []);

  const loadDataStatus = useCallback(async () => {
    try {
      setDataStatus(await api.dataStatus());
    } catch {
      setDataStatus(null);
    }
  }, []);

  const loadTop10 = useCallback(async () => {
    try {
      const result = await api.top10();
      setTop10Items(result.items);
    } catch {
      setTop10Items([]);
    }
  }, []);

  useEffect(() => {
    void loadUser();
    void loadScreen(emptyFilters, 1);
    // Load feature data when the page is visible.
    void loadMarketIndices();
    void loadMarketOverview();
    void loadRefresh();
    void loadDataStatus();

    const hash = window.location.hash;
    if (hash.startsWith("#stock=")) {
      const code = hash.replace("#stock=", "").trim();
      if (code) {
        void api.screener({ code, page: 1, pageSize: 10 }).then((res) => {
          if (res.items.length) {
            setSelectedStock(res.items[0]);
          }
        }).catch((reason) => setError(reason instanceof Error ? reason.message : "详情加载失败。"));
      }
    }

  }, [loadDataStatus, loadMarketHeatmap, loadMarketIndices, loadMarketOverview, loadRecommendations, loadRefresh, loadScreen, loadTop10, loadUser]);

  useEffect(() => {
    if (navTab === "heatmap") void loadMarketHeatmap();
    if (navTab === "recommendations") { void loadTop10(); if (user) void loadRecommendations(); }
  }, [navTab, user, loadMarketHeatmap, loadTop10, loadRecommendations]);

  useEffect(() => {
    if (refresh?.status !== "queued" && refresh?.status !== "running") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const { refresh: latest } = await api.dataRefresh();
        if (cancelled) return;
        setRefresh(latest);
        if (latest?.status === "completed") {
          await Promise.all([loadScreen(filters, 1), loadDataStatus(), loadMarketIndices(), loadMarketOverview(), loadMarketHeatmap()]);
        }
        if (latest?.status !== "running" && latest?.status !== "queued") return;
      } catch { if (!cancelled) setRefreshError("更新状态暂时无法读取，正在重试。"); }
      if (!cancelled) timer = setTimeout(() => void poll(), document.hidden ? 30000 : 5000);
    };
    timer = setTimeout(() => void poll(), 3000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [refresh?.id, refresh?.status, filters, loadScreen, loadDataStatus, loadMarketIndices, loadMarketOverview, loadMarketHeatmap]);

  function handleSelectStock(stock: ScreenerItem, fullScreen = false) {
    setSelectedStock(stock);
    setIsFullScreenDetail(fullScreen);
    window.location.hash = `stock=${stock.code}`;
  }

  function handleCloseDetail() {
    setSelectedStock(null);
    setIsFullScreenDetail(false);
    window.history.pushState(null, "", window.location.pathname);
  }

  async function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    await loadScreen(filters, 1);
  }

  async function resetFilters() {
    setFilters(emptyFilters);
    setCategoryTab("all");
    await loadScreen(emptyFilters, 1);
  }

  function handleCategoryTabChange(tab: "all" | "stocks" | "etfs") {
    setCategoryTab(tab);
    setPage(1);
    const nextFilters = { ...filters };
    nextFilters.code = "";
    nextFilters.instrumentType = tab === "all" ? "" : tab === "stocks" ? "stock" : "etf";
    setFilters(nextFilters);
    void loadScreen(nextFilters, 1);
  }

  function handleSort(sortBy: string) {
    const nextDirection = filters.sortBy === sortBy && filters.sortDirection === "desc" ? "asc" : "desc";
    const nextFilters = { ...filters, sortBy, sortDirection: nextDirection };
    setFilters(nextFilters);
    void loadScreen(nextFilters, 1);
  }

  function handleQuickSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchKeyword.trim();
    if (!query) return;
    const isCode = /^\d+$/.test(query);
    const nextFilters: FilterState = {
      ...emptyFilters,
      code: isCode ? query : "",
      name: isCode ? "" : query,
    };
    setFilters(nextFilters);
    navigateToTab("screener");
    setPage(1);
    void loadScreen(nextFilters, 1);
  }

  function handleSelectIndustry(industry: string) {
    const nextFilters: FilterState = { ...emptyFilters, industry };
    setFilters(nextFilters);
    setCategoryTab("all");
    navigateToTab("screener");
    setPage(1);
    void loadScreen(nextFilters, 1);
  }

  async function addToWatchlist(code: string) {
    if (!user) {
      setShowLogin(true);
      return;
    }
    try {
      await api.addWatchlist(code);
      await loadUser();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "加入自选失败。");
    }
  }

  async function removeWatchlist(code: string) {
    try {
      await api.removeWatchlist(code);
      await loadUser();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "移除自选失败。");
    }
  }

  const marketStats = marketOverview && marketOverview.ret20AvailableCount > 0
    ? {
        up: marketOverview.upCount,
        down: marketOverview.downCount,
        avgRet: marketOverview.averageRet20,
        avgScore: marketOverview.averageScore,
        highScores: marketOverview.highScoreCount,
        upPct: (marketOverview.upCount / marketOverview.ret20AvailableCount) * 100,
      }
    : null;

  const pageCount = Math.max(1, Math.ceil(total / 25));

  return (
    <div className={`app-root ${theme}`}>
      <main className={navTab === "heatmap" ? "app-shell heatmap-shell" : "app-shell"}>
        {/* Top Header */}
        <header>
          <div className="header-brand">
            <p className="eyebrow">A 股主板 & ETF 量化分析工作台</p>
            <h1>A 股量化工作台</h1>
          </div>

          <form className="quick-search-form" onSubmit={handleQuickSearch}>
            <input
              type="text"
              placeholder="🔍 极速检索代码/名称 (如 600519, 茅台)..."
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              className="quick-search-input"
            />
          </form>

          <div className="header-right">
            {asOf && <span className="data-date-badge">基准日: {asOf}</span>}
            <button className="theme-toggle-btn" onClick={toggleTheme} title="切换明暗主题">
              {theme === "light" ? "🌙 暗黑模式" : "☀️ 明亮模式"}
            </button>
            {user ? (
              <div className="account-actions">
                <span>{user.displayName ?? user.username}</span>
                {user.isAdmin && <button className="text-button" disabled={refresh?.status === "queued" || refresh?.status === "running"} onClick={() => void requestRefresh()}>{refresh?.status === "queued" || refresh?.status === "running" ? "更新中" : "更新数据"}</button>}
                <button className="text-button" onClick={() => void api.logout().then(loadUser)}>退出</button>
              </div>
            ) : (
              <button className="text-button" onClick={() => setShowLogin((visible) => !visible)}>
                {showLogin ? "关闭登录" : "账户登录"}
              </button>
            )}
          </div>
        </header>

        {showLogin && !user && <LoginPanel onSuccess={async () => { await loadUser(); setShowLogin(false); }} />}
        {error && <p className="error">{error}</p>}
        {refresh && <p className={refresh.status === "failed" ? "error" : "data-refresh-status"}>数据更新：{refresh.status}{refresh.tradeDate ? `，数据日期 ${refresh.tradeDate}` : ""}{refresh.error ? `，${refresh.error}` : ""}</p>}
        {refreshError && <p className="error">{refreshError}</p>}
        {dataStatus && <DataFreshnessBar status={dataStatus} />}

        <MarketIndexOverview items={marketIndices} />

        {/* Market Breadth Status Banner */}
        {marketStats && (
          <div className="market-breadth-banner">
            <div className="breadth-stat">
              <span className="b-label">20日多空分布</span>
              <div className="up-down-bar-wrap">
                <span className="up-text">涨 {marketStats.up}</span>
                <div className="up-down-bar">
                  <div className="up-fill" style={{ width: `${marketStats.upPct}%` }} />
                </div>
                <span className="down-text">跌 {marketStats.down}</span>
              </div>
            </div>
            <div className="breadth-stat">
              <span className="b-label">全市场平均20日涨幅</span>
              <span className={`b-val ${(marketStats.avgRet ?? 0) >= 0 ? "positive" : "negative"}`}>
                {formatRatioPercent(marketStats.avgRet)}
              </span>
            </div>
            <div className="breadth-stat">
              <span className="b-label">全池平均量化得分</span>
              <span className="b-val score-val">{formatNumber(marketStats.avgScore, 1)} 分</span>
            </div>
            <div className="breadth-stat">
              <span className="b-label">强势领涨 (≥ 70分)</span>
              <span className="b-val strong-val">{marketStats.highScores} 只</span>
            </div>
          </div>
        )}

        {/* Main Top Navigation Tabs */}
        <nav className="main-nav-bar">
          <button
            className={navTab === "screener" ? "nav-item active" : "nav-item"}
            onClick={() => navigateToTab("screener")}
          >
            🔍 选股大盘
          </button>
          <button
            className={navTab === "heatmap" ? "nav-item active" : "nav-item"}
            onClick={() => navigateToTab("heatmap")}
          >
            🔥 市场全景热力图
          </button>
          <button
            className={navTab === "recommendations" ? "nav-item active" : "nav-item"}
            onClick={() => navigateToTab("recommendations")}
          >
            🏆 每日量化精选 ({recommendations.length > 0 ? recommendations.length : "Top 10"})
          </button>
          <button
            className={navTab === "rules" ? "nav-item active" : "nav-item"}
            onClick={() => navigateToTab("rules")}
          >
            ⚙️ 规则选股 / AI 策略
          </button>
          <button
            className={navTab === "watchlist" ? "nav-item active" : "nav-item"}
            onClick={() => navigateToTab("watchlist")}
          >
            ⭐ 我的自选池 ({watchlist.length})
          </button>
        </nav>

        {/* VIEW 1: SCREENER (选股大盘) */}
        {navTab === "screener" && (
          <section className="view-container">
            <div className="universe-tabs-bar">
              <div className="universe-tabs">
                <button
                  className={categoryTab === "all" ? "tab-btn active" : "tab-btn"}
                  onClick={() => handleCategoryTabChange("all")}
                >
                  全部标的
                </button>
                <button
                  className={categoryTab === "stocks" ? "tab-btn active" : "tab-btn"}
                  onClick={() => handleCategoryTabChange("stocks")}
                >
                  沪深主板股票
                </button>
                <button
                  className={categoryTab === "etfs" ? "tab-btn active" : "tab-btn"}
                  onClick={() => handleCategoryTabChange("etfs")}
                >
                  ETF 基金
                </button>
              </div>
              <button
                className="secondary-button export-btn"
                onClick={() => exportToCsv(items, `选股大盘_${categoryTab}_${asOf || "latest"}.csv`)}
              >
                📥 导出当前结果为 CSV
              </button>
            </div>

            <div className="screener-panel" aria-label="股票筛选条件">
              <div className="section-heading">
                <div>
                  <h2>多因子筛选条件</h2>
                  <span>支持技术指标、涨跌幅、波动率与综合得分组合过滤</span>
                </div>
              </div>
              <form className="filter-form" onSubmit={submitFilters}>
                <FilterInput label="代码" value={filters.code ?? ""} onChange={(value) => setFilters({ ...filters, code: value })} placeholder="600519 / 510300" />
                <FilterInput label="名称" value={filters.name ?? ""} onChange={(value) => setFilters({ ...filters, name: value })} placeholder="贵州茅台 / 300ETF" />
                <label>
                  市场
                  <select value={filters.market} onChange={(event) => setFilters({ ...filters, market: event.target.value })}>
                    <option value="">全部市场</option>
                    <option value="SH">沪市</option>
                    <option value="SZ">深市</option>
                  </select>
                </label>
                <FilterInput label="行业/板块" value={filters.industry ?? ""} onChange={(value) => setFilters({ ...filters, industry: value })} placeholder="白酒 / 半导体" />
                <FilterInput label="最低价格" value={filters.minPrice ?? ""} onChange={(value) => setFilters({ ...filters, minPrice: value })} type="number" />
                <FilterInput label="最高价格" value={filters.maxPrice ?? ""} onChange={(value) => setFilters({ ...filters, maxPrice: value })} type="number" />
                <FilterInput label="20日最低涨幅 %" value={filters.minRet20 ?? ""} onChange={(value) => setFilters({ ...filters, minRet20: value })} type="number" />
                <FilterInput label="20日最高涨幅 %" value={filters.maxRet20 ?? ""} onChange={(value) => setFilters({ ...filters, maxRet20: value })} type="number" />
                <FilterInput label="最低换手率 %" value={filters.minTurnover ?? ""} onChange={(value) => setFilters({ ...filters, minTurnover: value })} type="number" />
                <FilterInput label="最高波动率" value={filters.maxVolatility ?? ""} onChange={(value) => setFilters({ ...filters, maxVolatility: value })} type="number" />
                <FilterInput label="最低技术分" value={filters.minScore ?? ""} onChange={(value) => setFilters({ ...filters, minScore: value })} type="number" />
                <label>
                  排序依据
                  <select value={filters.sortBy} onChange={(event) => setFilters({ ...filters, sortBy: event.target.value })}>
                    <option value="score">综合得分</option>
                    <option value="ret20">20日涨幅</option>
                    <option value="turnover">换手率</option>
                    <option value="price">收盘价</option>
                    <option value="volatility">波动率</option>
                  </select>
                </label>
                <label>
                  排序方向
                  <select value={filters.sortDirection} onChange={(event) => setFilters({ ...filters, sortDirection: event.target.value })}>
                    <option value="desc">从高到低 (降序)</option>
                    <option value="asc">从低到高 (升序)</option>
                  </select>
                </label>
                <div className="filter-actions">
                  <button type="submit">{loading ? "筛选中..." : "开始筛选"}</button>
                  <button type="button" className="secondary-button" onClick={() => void resetFilters()}>重置</button>
                </div>
              </form>
            </div>

            <div className="screener-results-wrap">
              <div className="section-heading">
                <div>
                  <h2>筛选结果列表</h2>
                  <span>共 {total} 个标的（点击任意表头快速排序，点击行查看深度详情）</span>
                </div>
                <span>第 {page} / {pageCount} 页</span>
              </div>
              <ScreenerTable
                items={items}
                user={user}
                currentSortBy={filters.sortBy}
                currentSortDir={filters.sortDirection}
                onSort={handleSort}
                onAdd={addToWatchlist}
                onSelect={(item) => handleSelectStock(item, false)}
                onOpenFull={(item) => handleSelectStock(item, true)}
              />
              <div className="pagination">
                <button className="icon-button" title="上一页" disabled={page <= 1 || loading} onClick={() => void loadScreen(filters, page - 1)}>‹</button>
                <span>{page} / {pageCount}</span>
                <button className="icon-button" title="下一页" disabled={page >= pageCount || loading} onClick={() => void loadScreen(filters, page + 1)}>›</button>
              </div>
            </div>
          </section>
        )}

        {/* VIEW 2: HEATMAP (市场全景热力图) */}
        {navTab === "heatmap" && (
          <SectorFundTreemap
            {...marketHeatmap}
            onSelectIndustry={handleSelectIndustry}
          />
        )}

        {/* VIEW 3: RECOMMENDATIONS (每日量化精选推荐) */}
        {navTab === "recommendations" && (
          <RecommendationsView
            recommendations={recommendations}
            screenerItems={top10Items}
            user={user}
            watchlist={watchlist}
            onAdd={addToWatchlist}
            onSelectStock={(item) => handleSelectStock(item, false)}
          />
        )}

        {/* VIEW 4: CUSTOM RULE SCREENER (规则选股 / AI 策略) */}
        {navTab === "rules" && (
          <CustomRuleScreenerView
            user={user}
            onAdd={addToWatchlist}
            onSelectStock={(item) => handleSelectStock(item, false)}
            onOpenFull={(item) => handleSelectStock(item, true)}
          />
        )}

        {/* VIEW 5: WATCHLIST (我的自选池) */}
        {navTab === "watchlist" && (
          <section className="view-container">
            <div className="section-heading">
              <div>
                <h2>我的自选池</h2>
                <span>记录加入基准日与基准收盘价，持续跟踪真实收益表现</span>
              </div>
              <button
                className="secondary-button export-btn"
                onClick={() => {
                  downloadCsv(["代码", "名称", "观察日期", "观察价格", "最新报价日期", "最新价", "观察以来价格收益(%)"],
                    watchlist.map((w) => [`\t${w.code}`,w.name,w.observationTradeDate,w.observationClose,w.latestTradeDate,w.latestClose,w.tracking.returnPct]), "我的自选池.csv");
                }}
              >
                📥 导出自选池为 CSV
              </button>
            </div>
            <WatchlistTable
              items={watchlist}
              onRemove={removeWatchlist}
              onSelectCode={(code) => {
                const found = items.find((i) => i.code === code);
                if (found) {
                  handleSelectStock(found, false);
                } else {
                  void api.screener({ code, page: 1, pageSize: 10 }).then((res) => {
                    if (res.items.length) handleSelectStock(res.items[0], false);
                  }).catch((reason) => setError(reason instanceof Error ? reason.message : "详情加载失败。"));
                }
              }}
            />
          </section>
        )}

        {/* STOCK DETAIL MODAL / DRAWER */}
        {selectedStock && (
          <StockDetailPage
            stock={selectedStock}
            user={user}
            theme={theme}
            isFullScreen={isFullScreenDetail}
            isWatchlisted={watchlist.some((w) => w.code === selectedStock.code)}
            onAdd={addToWatchlist}
            onToggleFullScreen={() => setIsFullScreenDetail((prev) => !prev)}
            onClose={handleCloseDetail}
          />
        )}
      </main>
    </div>
  );
}

function FilterInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label>
      {label}
      <input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function LoginPanel({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.login(username, password);
      await onSuccess();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "登录失败。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="login-panel">
      <form className="login-form" onSubmit={submit}>
        <FilterInput label="用户名" value={username} onChange={setUsername} />
        <FilterInput label="密码" value={password} onChange={setPassword} type="password" />
        <div className="filter-actions">
          <button type="submit" disabled={submitting}>{submitting ? "登录中..." : "登录"}</button>
        </div>
        {error && <p className="error">{error}</p>}
      </form>
    </section>
  );
}

function ScreenerTable({
  items,
  user,
  currentSortBy,
  currentSortDir,
  onSort,
  onAdd,
  onSelect,
  onOpenFull,
}: {
  items: ScreenerItem[];
  user: User | null;
  currentSortBy?: string;
  currentSortDir?: string;
  onSort?: (col: string) => void;
  onAdd: (code: string) => Promise<void>;
  onSelect: (item: ScreenerItem) => void;
  onOpenFull: (item: ScreenerItem) => void;
}) {
  if (!items.length) {
    return <p className="empty">暂无符合条件的数据。请先完成数据发布，或放宽筛选条件。</p>;
  }

  function renderSortIcon(col: string) {
    if (currentSortBy !== col) return " ↕";
    return currentSortDir === "desc" ? " ↓" : " ↑";
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>标的名称 / 代码</th>
            <th>市场 / 行业</th>
            <th className="sortable-th" onClick={() => onSort?.("price")}>
              最新收盘价{renderSortIcon("price")}
            </th>
            <th className="sortable-th" onClick={() => onSort?.("ret20")}>
              20日涨跌幅{renderSortIcon("ret20")}
            </th>
            <th className="sortable-th" onClick={() => onSort?.("turnover")}>
              换手率{renderSortIcon("turnover")}
            </th>
            <th className="sortable-th" onClick={() => onSort?.("volatility")}>
              20日波动率{renderSortIcon("volatility")}
            </th>
            <th className="sortable-th" onClick={() => onSort?.("score")}>
              量化综合分{renderSortIcon("score")}
            </th>
            <th>数据基准日</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.code} className="clickable-row" onClick={() => onSelect(item)}>
              <td>
                <strong className="stock-name-cell">{item.name}</strong>
                <small className="stock-code-cell">{item.code}</small>
              </td>
              <td>
                {item.market ?? "-"}
                <small>{item.industry ?? "-"}</small>
              </td>
              <td className="price-cell">¥ {formatNumber(item.close)}</td>
              <td className={item.ret20d !== null && item.ret20d < 0 ? "negative" : "positive"}>
                {formatRatioPercent(item.ret20d)}
              </td>
              <td>{formatNumber(item.turnoverRate)}%</td>
              <td>{(item.volatility20 === null ? "-" : `${(item.volatility20 * 100).toFixed(2)}%`)}</td>
              <td>
                <span className="score-badge">{formatNumber(item.score, 1)}</span>
                <small>{item.dataCompleteness === null ? "-" : `${(item.dataCompleteness * 100).toFixed(0)}% 完整`}</small>
              </td>
              <td title={`历史指标基准日: ${item.tradeDate}`}>
                {marketDate(item)}{item.quoteTime ? <small>{item.quoteTime}</small> : null}
              </td>
              <td onClick={(e) => e.stopPropagation()}>
                <div className="row-actions">
                  <button className="small-button secondary-button" onClick={() => onOpenFull(item)}>
                    详情
                  </button>
                  <button className="small-button" onClick={() => void onAdd(item.code)}>
                    {user ? "自选" : "登录自选"}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WatchlistTable({
  items,
  onRemove,
  onSelectCode,
}: {
  items: WatchlistItem[];
  onRemove: (code: string) => Promise<void>;
  onSelectCode: (code: string) => void;
}) {
  if (!items.length) return <p className="empty">尚未加入自选股。可从选股大盘、推荐池或规则选股中点击加入。</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>标的名称 / 代码</th>
            <th>加入基准 (日期/价格)</th>
            <th>最新价格 (最新日期)</th>
            <th>观察期间收益</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.code} className="clickable-row" onClick={() => onSelectCode(item.code)}>
              <td>
                <strong className="stock-name-cell">{item.name}</strong>
                <small className="stock-code-cell">{item.code}</small>
              </td>
              <td>
                {item.observationTradeDate}
                <small>¥ {formatNumber(item.observationClose)}</small>
              </td>
              <td>
                <span className="price-cell">¥ {formatNumber(item.latestClose)}</span>
                <small>{item.latestTradeDate}</small>
              </td>
              <td className={item.tracking.returnPct !== null && item.tracking.returnPct < 0 ? "negative" : "positive"}>
                <strong>{formatPercent(item.tracking.returnPct)}</strong>
              </td>
              <td onClick={(e) => e.stopPropagation()}>
                <button className="icon-button" title="移除自选股" onClick={() => void onRemove(item.code)}>×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** ------------------- MARKET HEATMAP COMPONENT ------------------- */
function formatFundAmount(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1e8) return `${(value / 1e8).toFixed(1)}亿`;
  if (absolute >= 1e4) return `${(value / 1e4).toFixed(0)}万`;
  return value.toFixed(0);
}

function DataFreshnessBar({ status }: { status: DataStatus }) {
  const formatTime = (value: string | null) => value
    ? new Date(value).toLocaleString("zh-CN", { hour12: false })
    : "未同步";
  const freshnessClass = (value: string | null, isLive = false) => {
    if (!value) return "missing";
    if (isLive && Date.now() - new Date(value).getTime() > 15 * 60 * 1000) return "stale";
    return isLive ? "fresh" : "settled";
  };
  const items = [
    { label: "行情", value: status.quoteUpdatedAt, live: true },
    { label: "板块资金", value: status.industryFundFlowUpdatedAt, live: true },
    { label: "日结因子", value: status.screenerTradeDate, live: false, dateOnly: true },
    { label: "个股资金", value: status.stockMoneyFlowUpdatedAt, live: false },
    { label: "估值", value: status.valuationUpdatedAt, live: false },
    { label: "财务", value: status.financialUpdatedAt, live: false },
  ];
  return (
    <div className="data-freshness" aria-label="数据更新时间">
      {items.map((item) => (
        <span key={item.label} className={freshnessClass(item.value, item.live)}>
          {item.label} {item.dateOnly ? item.value ?? "未同步" : formatTime(item.value)}
        </span>
      ))}
    </div>
  );
}

function fundFlowColor(ratio: number | null): string {
  if (ratio === null) return "#64748b";
  if (ratio >= 0.02) return "#991b1b";
  if (ratio >= 0.01) return "#dc2626";
  if (ratio > 0) return "#f87171";
  if (ratio <= -0.02) return "#166534";
  if (ratio <= -0.01) return "#16a34a";
  if (ratio < 0) return "#4ade80";
  return "#94a3b8";
}

function SectorFundTreemap({
  items,
  asOf,
  updatedAt,
  moneyFlowAvailable,
  onSelectIndustry,
}: {
  items: SectorHeatmapItem[];
  asOf: string | null;
  updatedAt: string | null;
  moneyFlowAvailable: boolean;
  onSelectIndustry: (industry: string) => void;
}) {
  const leaves = useMemo(() => {
    type TreeNode = SectorHeatmapItem | { children: SectorHeatmapItem[] };
    const root = hierarchy<TreeNode>({ children: items })
      .sum((node) => "inflowAmount" in node ? Math.max(node.inflowAmount + node.outflowAmount, 1) : 0)
      .sort((left, right) => (right.value ?? 0) - (left.value ?? 0));
    return treemap<TreeNode>().size([1000, 720]).paddingInner(3).paddingOuter(2).round(true)(root).leaves()
      .map((leaf) => ({ ...leaf, sector: leaf.data as SectorHeatmapItem }));
  }, [items]);

  return (
    <section className="view-container heatmap-view sector-fund-heatmap">
      <div className="section-heading">
        <div>
          <h2>板块资金热力图</h2>
          <span>面积按流入与流出总额，颜色按净流入率</span>
        </div>
        <div className="heatmap-asof">
          <span>数据日 {asOf ?? "-"}</span>
          <span>更新 {updatedAt ? new Date(updatedAt).toLocaleString("zh-CN", { hour12: false }) : "-"}</span>
        </div>
      </div>
      <div className="heatmap-legend sector-fund-legend">
        <span className="legend-down">净流出</span><i className="legend-down-swatch" /><span>平衡</span><i className="legend-flat" /><span>净流入</span><i className="legend-up" /><em>点击板块查看对应行业股票</em>
      </div>
      {!moneyFlowAvailable && <p className="heatmap-data-warning">暂无当天板块资金流数据，请在首页执行刷新。</p>}
      {!leaves.length ? <div className="empty">暂无可用的当天板块资金流数据。</div> : (
        <svg className="sector-fund-treemap" viewBox="0 0 1000 720" role="img" aria-label="按资金活动面积展示的板块资金热力图">
          {leaves.map((leaf) => {
            const { sector } = leaf;
            const width = leaf.x1 - leaf.x0;
            const height = leaf.y1 - leaf.y0;
            const showTitle = width >= 28 && height >= 18;
            const showFlow = width >= 130 && height >= 58;
            const showMeta = width >= 250 && height >= 78;
            const titleFontSize = Math.max(7, Math.min(18, Math.floor(Math.min(height - 6, (width - 8) / 2.2))));
            const titleLength = Math.max(2, Math.floor((width - 8) / titleFontSize));
            const title = sector.industry.length > titleLength
              ? titleLength >= 4 ? `${sector.industry.slice(0, titleLength - 1)}...` : sector.industry.slice(0, titleLength)
              : sector.industry;
            const activityAmount = sector.inflowAmount + sector.outflowAmount;
            const flowRatio = activityAmount > 0 ? formatRatioPercent(sector.netInflow / activityAmount) : "-";
            return (
              <g
                key={sector.industry}
                className="sector-fund-tile"
                role="button"
                tabIndex={0}
                transform={`translate(${leaf.x0}, ${leaf.y0})`}
                onClick={() => onSelectIndustry(sector.industry)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectIndustry(sector.industry);
                  }
                }}
              >
                <title>{`${sector.industry}\n流入 ${formatFundAmount(sector.inflowAmount)}\n流出 ${formatFundAmount(sector.outflowAmount)}\n净流入 ${formatFundAmount(sector.netInflow)}\n净流入率 ${flowRatio}\n公司 ${sector.companyCount ?? "-"} 家`}</title>
                <rect width={width} height={height} fill={fundFlowColor(activityAmount > 0 ? sector.netInflow / activityAmount : null)} rx="2" />
                {showTitle && <text className="sector-fund-name" x="4" y={titleFontSize + 4} style={{ fontSize: titleFontSize }}>{title}</text>}
                {showFlow && <>
                  <text className="sector-fund-value" x="10" y="47">{flowRatio}</text>
                </>}
                {showMeta && <>
                  <text className="sector-fund-meta" x="10" y="67">流入 {formatFundAmount(sector.inflowAmount)} · 流出 {formatFundAmount(sector.outflowAmount)}</text>
                </>}
              </g>
            );
          })}
        </svg>
      )}
    </section>
  );
}

function CustomRuleScreenerView({
  user,
  onAdd,
  onSelectStock,
  onOpenFull,
}: {
  user: User | null;
  onAdd: (code: string) => Promise<void>;
  onSelectStock: (item: ScreenerItem) => void;
  onOpenFull: (item: ScreenerItem) => void;
}) {
  const [conditions, setConditions] = useState<RuleCondition[]>([
    { field: "score", op: ">=", value: 70 },
    { field: "ret20d", op: ">=", value: 0 },
  ]);
  const [logic, setLogic] = useState<RuleScreenerRequest["logic"]>("AND");
  const [excludeSt, setExcludeSt] = useState(true);
  const [sortBy, setSortBy] = useState<RuleScreenerRequest["sortBy"]>("score");
  const [sortDirection, setSortDirection] = useState<RuleScreenerRequest["sortDirection"]>("desc");
  const [rulePage,setRulePage]=useState(1);
  const ruleSnapshot=useRef<string | null>(null);
  const ruleRequest=useRef(0);
  const [matchedItems, setMatchedItems] = useState<ScreenerItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jsonInput, setJsonInput] = useState("");
  const [promptCopied, setPromptCopied] = useState(false);
  const [ruleDataCapabilities, setRuleDataCapabilities] = useState<RuleDataCapabilities | null>(null);
  const [strategyName, setStrategyName] = useState("");
  const [savedStrategies, setSavedStrategies] = useState<SavedStrategy[]>([]);
  const [savingStrategy, setSavingStrategy] = useState(false);
  const fields: Array<{ value: RuleCondition["field"]; label: string; numeric: boolean }> = [
    { value: "score", label: "综合评分", numeric: true }, { value: "ret5d", label: "5日涨幅（0.05=5%）", numeric: true },
    { value: "ret20d", label: "20日涨幅（0.05=5%）", numeric: true }, { value: "ret60d", label: "60日涨幅（0.05=5%）", numeric: true }, { value: "ret120d", label: "120日涨幅（0.05=5%）", numeric: true }, { value: "ret250d", label: "250日涨幅（0.05=5%）", numeric: true },
    { value: "ma20Slope", label: "MA20 斜率", numeric: true }, { value: "volumeRatio20", label: "20日量比", numeric: true },
    { value: "volumeRatio5", label: "5日量比", numeric: true }, { value: "amount", label: "成交额", numeric: true }, { value: "amountRatio5", label: "5日成交额比", numeric: true }, { value: "amountRatio20", label: "20日成交额比", numeric: true }, { value: "rsi14", label: "RSI(14)", numeric: true },
    { value: "volatility20", label: "20日波动率（0.2=20%）", numeric: true }, { value: "volatility60", label: "60日波动率（0.2=20%）", numeric: true }, { value: "maxDrawdown60", label: "60日最大回撤（-0.2=-20%）", numeric: true },
    { value: "distanceHigh20", label: "距20日高点（-0.05=-5%）", numeric: true }, { value: "distanceHigh60", label: "距60日高点（-0.05=-5%）", numeric: true }, { value: "distanceHigh250", label: "距250日高点（-0.05=-5%）", numeric: true }, { value: "distanceLow250", label: "距250日低点（0.1=10%）", numeric: true }, { value: "pricePercentile250", label: "250日价格分位 (0-1)", numeric: true }, { value: "turnoverRate", label: "换手率 (%)", numeric: true },
    { value: "mainNetInflow", label: "今日主力净流入（元）", numeric: true }, { value: "mainNetInflowPct", label: "今日主力净占比 (%)", numeric: true }, { value: "superLargeNetInflow", label: "今日超大单净流入（元）", numeric: true }, { value: "largeNetInflow", label: "今日大单净流入（元）", numeric: true }, { value: "mediumNetInflow", label: "今日中单净流入（元）", numeric: true }, { value: "smallNetInflow", label: "今日小单净流入（元）", numeric: true }, { value: "mainNetInflow3d", label: "3日主力净流入（元）", numeric: true }, { value: "mainNetInflow5d", label: "5日主力净流入（元）", numeric: true }, { value: "mainNetInflow10d", label: "10日主力净流入（元）", numeric: true },
    { value: "peTtm", label: "市盈率 TTM", numeric: true }, { value: "pb", label: "市净率 PB", numeric: true }, { value: "totalMarketCap", label: "总市值（元）", numeric: true }, { value: "floatMarketCap", label: "流通市值（元）", numeric: true },
    { value: "roe", label: "净资产收益率 ROE (%)", numeric: true }, { value: "revenueYoy", label: "营收同比 (%)", numeric: true }, { value: "profitYoy", label: "净利润同比 (%)", numeric: true }, { value: "grossMargin", label: "销售毛利率 (%)", numeric: true }, { value: "debtRatio", label: "资产负债率 (%)", numeric: true }, { value: "revenue", label: "营业收入（元）", numeric: true }, { value: "netProfit", label: "净利润（元）", numeric: true },
    { value: "close", label: "最新价", numeric: true }, { value: "industry", label: "所属行业", numeric: false }, { value: "market", label: "市场", numeric: false },
  ];
  const fieldMeta = (field: RuleCondition["field"]) => fields.find((item) => item.value === field)!;
  const availableFields = fields.filter((field) => {
    const capability = OPTIONAL_RULE_FIELD_CAPABILITIES[field.value];
    return !capability || ruleDataCapabilities === null || ruleDataCapabilities[capability];
  });
  const isUnavailableField = (field: RuleCondition["field"]) => {
    const capability = OPTIONAL_RULE_FIELD_CAPABILITIES[field];
    return capability !== undefined && ruleDataCapabilities !== null && !ruleDataCapabilities[capability];
  };
  useEffect(() => {
    void api.ruleDataCapabilities().then(setRuleDataCapabilities).catch(() => setRuleDataCapabilities(null));
  }, []);
  useEffect(() => {
    if (!user) {
      setSavedStrategies([]);
      return;
    }
    void api.savedStrategies().then(({ items }) => setSavedStrategies(items)).catch(() => setSavedStrategies([]));
  }, [user]);
  const aiGenerationPrompt = `请将下面的选股想法转换为本系统支持的 JSON，不要输出 Markdown、解释或任何额外文字。\n\n输出结构：{ "logic": "AND" | "OR", "excludeSt": true | false, "sortBy": "score" | "price" | "ret20" | "turnover" | "volatility", "sortDirection": "asc" | "desc", "conditions": [{ "field": string, "op": string, "value": number|string }] }\n\n所有数值字段的 value 必须是数字，op 只能是 >、>=、<、<=、==、!=。技术字段：score；ret5d/ret20d/ret60d/ret120d/ret250d；ma20Slope；volumeRatio5/volumeRatio20；amount/amountRatio5/amountRatio20（元/比值）；rsi14（0-100）；volatility20/volatility60；maxDrawdown60；distanceHigh20/distanceHigh60/distanceHigh250/distanceLow250；pricePercentile250（0-1）；turnoverRate；close。\n\n资金字段（元或百分比）：mainNetInflow、mainNetInflowPct、superLargeNetInflow、largeNetInflow、mediumNetInflow、smallNetInflow、mainNetInflow3d、mainNetInflow5d、mainNetInflow10d。\n\n估值字段：peTtm（市盈率 TTM）、pb（市净率）、totalMarketCap（总市值，元）、floatMarketCap（流通市值，元）。财务字段（百分比或元）：roe、revenueYoy、profitYoy、grossMargin、debtRatio、revenue、netProfit。\n\n文本字段：industry=所属行业；market=市场。文本 value 必须非空，op 只能是 contains、==、!=。conditions 至少 1 条、最多 20 条；AND 表示全部满足，OR 表示任一满足。不要使用未列出的字段、运算符、括号、嵌套对象、自然语言条件或空值。\n\n示例：{"logic":"AND","excludeSt":true,"sortBy":"score","sortDirection":"desc","conditions":[{"field":"roe","op":">=","value":12},{"field":"profitYoy","op":">=","value":20},{"field":"mainNetInflow5d","op":">=","value":100000000}]}`;
  const addCondition = () => { if (conditions.length < 20) setConditions([...conditions, { field: "ret20d", op: ">=", value: 0 }]); };
  function applyPreset(preset: (typeof TECHNICAL_RULE_PRESETS)[number]) {
    setConditions(preset.conditions);
    setLogic("AND");
    setExcludeSt(true);
    setSortBy("score");
    setSortDirection("desc");
    setMatchedItems([]);
    setTotal(null);
    setError(null);
  }
  function applySavedStrategy(strategy: SavedStrategy) {
    setConditions(strategy.rule.conditions);
    setLogic(strategy.rule.logic);
    setExcludeSt(strategy.rule.excludeSt);
    setSortBy(strategy.rule.sortBy);
    setSortDirection(strategy.rule.sortDirection);
    setMatchedItems([]);
    setTotal(null);
    setError(null);
  }
  async function saveCurrentStrategy() {
    if (!user || !strategyName.trim()) return;
    const unavailable = conditions.find((condition) => isUnavailableField(condition.field));
    if (unavailable) {
      setError("所选字段的数据尚未就绪。");
      return;
    }
    setSavingStrategy(true);
    try {
      const rule = { logic, conditions, excludeSt, sortBy, sortDirection };
      const { item } = await api.saveStrategy(strategyName.trim(), rule);
      setSavedStrategies((current) => [item, ...current.filter((strategy) => strategy.id !== item.id)]);
      setStrategyName("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "策略保存失败。");
    } finally {
      setSavingStrategy(false);
    }
  }
  async function removeSavedStrategy(strategy: SavedStrategy) {
    try {
      await api.removeStrategy(strategy.id);
      setSavedStrategies((current) => current.filter((item) => item.id !== strategy.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "策略删除失败。");
    }
  }
  function updateCondition(index: number, update: Partial<RuleCondition>) {
    setConditions(conditions.map((condition, position) => {
      if (position !== index) return condition;
      const next = { ...condition, ...update };
      if (update.field) { const numeric = fieldMeta(update.field).numeric; next.op = numeric ? ">=" : "contains"; next.value = numeric ? 0 : ""; }
      return next;
    }));
  }
  async function runScreener(nextPage=1) {
    const unavailable = conditions.find((condition) => isUnavailableField(condition.field));
    if (unavailable) {
      setError("所选字段的数据尚未就绪。");
      return;
    }
    const requestId=++ruleRequest.current;
    setLoading(true); setError(null);
    try {
      const result = await api.ruleScreener({ logic, conditions, excludeSt, sortBy, sortDirection, page: nextPage, pageSize: 100, snapshotId: nextPage>1 ? ruleSnapshot.current ?? undefined : undefined });
      if(requestId!==ruleRequest.current) return;
      ruleSnapshot.current=result.snapshotId; setRulePage(nextPage); setMatchedItems(result.items); setTotal(result.total);
    } catch (reason) { if(requestId===ruleRequest.current) setError(reason instanceof Error ? reason.message : "规则选股执行失败。"); }
    finally { if(requestId===ruleRequest.current) setLoading(false); }
  }
  function importJsonRules() {
    try {
      const input: unknown = JSON.parse(jsonInput);
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("JSON 顶层必须是一个规则对象。");
      const rule = input as Partial<RuleScreenerRequest>;
      if (!Array.isArray(rule.conditions) || rule.conditions.length < 1 || rule.conditions.length > 20) throw new Error("conditions 必须是 1 到 20 条条件的数组。");
      const imported = rule.conditions.map((condition, index) => {
        if (!condition || typeof condition !== "object") throw new Error(`第 ${index + 1} 条条件无效。`);
        const item = condition as Partial<RuleCondition>;
        const meta = fields.find((field) => field.value === item.field);
        if (!meta) throw new Error(`第 ${index + 1} 条使用了不支持的字段。`);
        if (isUnavailableField(meta.value)) throw new Error(`第 ${index + 1} 条依赖的数据尚未就绪。`);
        const allowedOps = meta.numeric ? [">", ">=", "<", "<=", "==", "!="] : ["contains", "==", "!="];
        if (!item.op || !allowedOps.includes(item.op)) throw new Error(`第 ${index + 1} 条的比较符不适用于 ${meta.label}。`);
        if (meta.numeric && (typeof item.value !== "number" || !Number.isFinite(item.value))) throw new Error(`第 ${index + 1} 条的 ${meta.label} 必须是数值。`);
        if (!meta.numeric && (typeof item.value !== "string" || !item.value.trim())) throw new Error(`第 ${index + 1} 条的 ${meta.label} 必须是非空文本。`);
        return { field: item.field, op: item.op, value: item.value } as RuleCondition;
      });
      if (rule.logic && rule.logic !== "AND" && rule.logic !== "OR") throw new Error("logic 只能是 AND 或 OR。");
      if (rule.sortBy && !["score", "price", "ret20", "turnover", "volatility"].includes(rule.sortBy)) throw new Error("sortBy 不受支持。");
      if (rule.sortDirection && rule.sortDirection !== "asc" && rule.sortDirection !== "desc") throw new Error("sortDirection 只能是 asc 或 desc。");
      if (rule.excludeSt !== undefined && typeof rule.excludeSt !== "boolean") throw new Error("excludeSt 必须是 true 或 false。");
      setConditions(imported); setLogic(rule.logic ?? "AND"); setExcludeSt(rule.excludeSt ?? true);
      setSortBy(rule.sortBy ?? "score"); setSortDirection(rule.sortDirection ?? "desc");
      setError(null);
    } catch (reason) { setError(reason instanceof Error ? `JSON 导入失败：${reason.message}` : "JSON 导入失败。"); }
  }
  function copyAiGenerationPrompt() {
    void navigator.clipboard.writeText(aiGenerationPrompt).then(() => {
      setPromptCopied(true);
      window.setTimeout(() => setPromptCopied(false), 2000);
    }).catch(() => setError("无法写入剪贴板，请手动复制下方生成规范。"));
  }

  return (
    <section className="view-container rule-screener-view">
      <div className="section-heading">
        <div>
          <h2>⚙️ 规则选股</h2>
          <span>添加选股条件后，系统会在完整市场快照中执行；不受搜索框、分页或当前页面数据影响。</span>
        </div>
        <button
          className="secondary-button export-btn"
          disabled={matchedItems.length === 0}
          onClick={() => exportToCsv(matchedItems, "规则选股结果.csv")}
        >
          📥 导出策略结果为 CSV
        </button>
      </div>

      <div className="rule-presets-bar">
        <span className="preset-label">条件关系</span>
        <select value={logic} onChange={(event) => setLogic(event.target.value as RuleScreenerRequest["logic"])}><option value="AND">同时满足（AND）</option><option value="OR">满足任一（OR）</option></select>
        <label className="rule-switch"><input type="checkbox" checked={excludeSt} onChange={(event) => setExcludeSt(event.target.checked)} /> 排除 ST</label>
        <span className="preset-label">排序</span>
        <select value={sortBy} onChange={(event) => setSortBy(event.target.value as RuleScreenerRequest["sortBy"])}><option value="score">综合评分</option><option value="ret20">20日涨幅</option><option value="price">最新价</option><option value="turnover">换手率</option><option value="volatility">波动率</option></select>
        <select value={sortDirection} onChange={(event) => setSortDirection(event.target.value as RuleScreenerRequest["sortDirection"])}><option value="desc">从高到低</option><option value="asc">从低到高</option></select>
        <span className="preset-label">技术策略</span>
        <div className="preset-buttons" aria-label="技术策略">
          {TECHNICAL_RULE_PRESETS.map((preset) => <button className="preset-btn" key={preset.label} onClick={() => applyPreset(preset)}>{preset.label}</button>)}
        </div>
        {user && savedStrategies.length > 0 && <>
          <span className="preset-label">已保存</span>
          <div className="preset-buttons" aria-label="已保存策略">
            {savedStrategies.map((strategy) => <span className="saved-strategy-chip" key={strategy.id}>
              <button className="preset-btn" onClick={() => applySavedStrategy(strategy)}>{strategy.name}</button>
              <button className="text-button saved-strategy-delete" aria-label={`删除策略 ${strategy.name}`} title="删除策略" onClick={() => void removeSavedStrategy(strategy)}>x</button>
            </span>)}
          </div>
        </>}
      </div>

      <div className="rule-editor-box">
        <details className="rule-json-import">
          <summary>从 AI 导入 JSON 规则</summary>
          <p>让 AI 只输出下方格式的 JSON，粘贴后点击导入；导入不会自动执行，便于先检查条件。</p>
          <details className="rule-ai-spec">
            <summary>AI 生成规范（字段说明与单位）</summary>
            <p><strong>量价技术：</strong>5/20 日量比、成交额、5/20 日成交额比、RSI(14)、5/20/60/120/250 日涨幅、MA20 斜率、20/60 日波动率、60 日最大回撤、距 20/60/250 日高低点、250 日价格分位、换手率和最新价。</p>
            <p><strong>资金、估值与财务：</strong>主力及大单资金流、PE/PB、总/流通市值、ROE、营收/利润同比、毛利率、资产负债率、营业收入与净利润均可用。财务按报告期和公告日留存。</p>
            <p><strong>数值运算符：</strong><code>&gt; &gt;= &lt; &lt;= == !=</code>。涨幅、回撤和距离字段均以小数保存，例如 5% 应填写 <code>0.05</code>；成交额、资金流、市值、营收和利润单位为元；250 日价格分位范围为 0 至 1。</p>
            <p><strong>文本：</strong>industry（所属行业）、market（市场）。运算符：<code>contains == !=</code>。</p>
            <p><strong>规则：</strong>最多 20 条；<code>AND</code> 为同时满足，<code>OR</code> 为任一满足。不得使用未列出的字段、括号、嵌套对象或自然语言条件。</p>
            <textarea className="rule-ai-prompt" value={aiGenerationPrompt} readOnly rows={16} aria-label="AI 规则生成提示词" />
            <button className="secondary-button" onClick={copyAiGenerationPrompt}>{promptCopied ? "已复制生成规范" : "复制 AI 生成提示词"}</button>
          </details>
          <textarea value={jsonInput} onChange={(event) => setJsonInput(event.target.value)} placeholder={'{"logic":"AND","excludeSt":true,"sortBy":"score","sortDirection":"desc","conditions":[{"field":"score","op":">=","value":70},{"field":"industry","op":"contains","value":"半导体"}]}'} rows={7} />
          <button className="secondary-button" onClick={importJsonRules}>导入 JSON 到条件编辑器</button>
          <code>{'{"logic":"AND","excludeSt":true,"sortBy":"score","sortDirection":"desc","conditions":[{"field":"score","op":">=","value":70}]}'}</code>
        </details>
        <div className="rule-builder-head"><strong>选股标准</strong><span>最多 20 条；数值字段支持大小比较，行业/市场支持包含或精确匹配。</span></div>
        {conditions.map((condition, index) => {
          const meta = fieldMeta(condition.field);
          const options = meta.numeric ? [">", ">=", "<", "<=", "==", "!="] : ["contains", "==", "!="];
          return <div className="rule-condition-row" key={`${condition.field}-${index}`}>
            <span className="rule-condition-index">{index + 1}</span>
            <select value={condition.field} onChange={(event) => updateCondition(index, { field: event.target.value as RuleCondition["field"] })}>{availableFields.map((field) => <option key={field.value} value={field.value}>{field.label}</option>)}</select>
            <select value={condition.op} onChange={(event) => updateCondition(index, { op: event.target.value as RuleCondition["op"] })}>{options.map((op) => <option key={op} value={op}>{op === "contains" ? "包含" : op}</option>)}</select>
            <input type={meta.numeric ? "number" : "text"} value={condition.value} step="any" placeholder={meta.numeric ? "请输入数值" : "如：半导体"} onChange={(event) => updateCondition(index, { value: meta.numeric ? Number(event.target.value) : event.target.value })} />
            <button className="text-button clear-btn" disabled={conditions.length === 1} onClick={() => setConditions(conditions.filter((_, position) => position !== index))}>删除</button>
          </div>;
        })}
        <div className="rule-editor-actions">
          {user && <>
            <input className="strategy-name-input" value={strategyName} maxLength={60} placeholder="策略名称" onChange={(event) => setStrategyName(event.target.value)} />
            <button className="secondary-button" disabled={savingStrategy || !strategyName.trim()} onClick={() => void saveCurrentStrategy()}>{savingStrategy ? "正在保存..." : "保存策略"}</button>
          </>}
          <button className="secondary-button" disabled={conditions.length >= 20} onClick={addCondition}>+ 增加选股标准</button>
          <button className="primary-button" disabled={loading} onClick={() => void runScreener()}>{loading ? "正在执行…" : "执行全市场选股"}</button>
        </div>
      </div>

      <div className="strategy-analysis-card">
        <div className="analysis-header">
          <div className="analysis-title">
            <span className="analysis-icon">🧠</span>
            <strong>规则执行状态</strong>
            <span className="strategy-tag">完整市场快照</span>
          </div>
          <div className="match-stats-pill">
            命中标的：<strong>{total ?? "—"}</strong>{total !== null && total > matchedItems.length ? `（展示前 ${matchedItems.length} 条）` : ""}
          </div>
        </div>

        <p className="analysis-desc">点击“执行全市场选股”后才会提交规则。搜索、市场热力和 Top10 使用各自的数据源，不会被这里的条件干扰。</p>
        <div className="conditions-tags-wrap"><span className="tags-label">当前标准：</span><div className="tags-list">{conditions.map((condition, index) => <span className="cond-pill" key={index}>{fieldMeta(condition.field).label} <strong>{condition.op === "contains" ? "包含" : condition.op} {condition.value}</strong></span>)}</div></div>
        {error && <div className="parse-errors"><p className="error-tip">{error}</p></div>}
      </div>

      {/* Results Table */}
      <div className="screener-results-wrap">
        <div className="section-heading">
          <div>
            <h3>策略匹配结果清单</h3>
            <span>{total === null ? "请先配置并执行选股条件" : `共找到 ${total} 只符合条件的标的，第 ${rulePage} 页，当前 ${matchedItems.length} 只`}</span>
          </div>
        </div>

        {total !== null && total>100 && <div className="pagination">
          <button disabled={loading || rulePage<=1} onClick={()=>void runScreener(rulePage-1)}>上一页</button>
          <span>{rulePage} / {Math.ceil(total/100)}</span>
          <button disabled={loading || rulePage*100>=total} onClick={()=>void runScreener(rulePage+1)}>下一页</button>
        </div>}
        <ScreenerTable
          items={matchedItems}
          user={user}
          onAdd={onAdd}
          onSelect={onSelectStock}
          onOpenFull={onOpenFull}
        />
      </div>
    </section>
  );
}

/** ------------------- STOCK DETAIL PAGE / DRAWER ------------------- */
