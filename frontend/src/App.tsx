import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { api, DataRefresh, MarketIndexItem, Recommendation, RuleCondition, RuleScreenerRequest, ScreenerItem, ScreenerQuery, User, WatchlistItem } from "./api";
import "./styles.css";

type FilterState = Omit<ScreenerQuery, "page" | "pageSize">;

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

function formatNumber(value: number | null, digits = 2): string {
  return value === null ? "-" : value.toFixed(digits);
}

function formatPercent(value: number | null): string {
  return value === null ? "-" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function marketDate(item: Pick<ScreenerItem | MarketIndexItem, "quoteDate" | "tradeDate">): string {
  return item.quoteDate ?? item.tradeDate;
}

function exportToCsv(items: ScreenerItem[], filename = "量化选股数据.csv") {
  const headers = ["代码", "名称", "市场", "行业", "最新收盘价", "20日涨跌幅(%)", "换手率(%)", "20日年化波动率", "综合量化得分", "数据基准日"];
  const rows = items.map((item) => [
    `\t${item.code}`, // \t prevents Excel from stripping leading zeros
    item.name,
    item.market ?? "",
    item.industry ?? "",
    item.close ?? "",
    item.ret20d ?? "",
    item.turnoverRate ?? "",
    item.volatility20 ?? "",
    item.score ?? "",
    marketDate(item),
  ]);
  const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.map((c) => `"${c}"`).join(","))].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
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
            <small>20d {formatPercent(item.ret20d)}</small>
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
  const [navTab, setNavTab] = useState<"screener" | "heatmap" | "recommendations" | "rules" | "watchlist">("screener");
  const [categoryTab, setCategoryTab] = useState<"all" | "stocks" | "etfs">("all");
  
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [marketIndices, setMarketIndices] = useState<MarketIndexItem[]>([]);
  const [refresh, setRefresh] = useState<DataRefresh | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [items, setItems] = useState<ScreenerItem[]>([]);
  const [marketHeatmapItems, setMarketHeatmapItems] = useState<ScreenerItem[]>([]);
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
      const list = await api.watchlist();
      setWatchlist(list.items);
    } catch {
      setUser(null);
      setWatchlist([]);
    }
  }, []);

  const loadRecommendations = useCallback(async () => {
    try {
      const res = await api.recommendations();
      setRecommendations(res.items);
    } catch {
      setRecommendations([]);
    }
  }, []);

  const loadMarketIndices = useCallback(async () => {
    try {
      const result = await api.marketIndices();
      setMarketIndices(result.items);
    } catch {
      setMarketIndices([]);
    }
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

  const loadScreen = useCallback(async (nextFilters: FilterState, nextPage: number) => {
    setLoading(true);
    try {
      const result = await api.screener({ ...nextFilters, page: nextPage, pageSize: 25 });
      setItems(result.items);
      setTotal(result.total);
      setPage(result.page);
      setAsOf(result.asOf);
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "筛选数据加载失败。");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMarketHeatmap = useCallback(async () => {
    try {
      const result = await api.marketHeatmap();
      setMarketHeatmapItems(result.items);
    } catch {
      setMarketHeatmapItems([]);
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
    void loadMarketHeatmap();
    void loadTop10();
    void loadRecommendations();
    void loadMarketIndices();
    void loadRefresh();

    const hash = window.location.hash;
    if (hash.startsWith("#stock=")) {
      const code = hash.replace("#stock=", "").trim();
      if (code) {
        void api.screener({ code, page: 1, pageSize: 1 }).then((res) => {
          if (res.items.length) {
            setSelectedStock(res.items[0]);
          }
        });
      }
    }

    const timer = setInterval(() => {
      void loadScreen(filters, page);
      void loadMarketHeatmap();
      void loadTop10();
      void loadRecommendations();
      void loadMarketIndices();
      void loadRefresh();
    }, 120000);

    return () => clearInterval(timer);
  }, [filters, loadMarketHeatmap, loadMarketIndices, loadRecommendations, loadRefresh, loadScreen, loadTop10, loadUser, page]);

  useEffect(() => {
    const code = selectedStock?.code;
    if (!code) return;
    let active = true;
    const refreshDetail = async () => {
      try {
        const result = await api.screener({ code, page: 1, pageSize: 1 });
        const latest = result.items[0];
        if (active && latest) {
          setSelectedStock((current) => (current?.code === code ? latest : current));
        }
      } catch {
        // Keep the last known detail data if a polling request fails.
      }
    };
    const timer = setInterval(() => void refreshDetail(), 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [selectedStock?.code]);

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
    setNavTab("screener");
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

  // Market Breadth Statistics
  const marketStats = useMemo(() => {
    if (!items.length) return null;
    const up = items.filter((i) => (i.ret20d ?? 0) > 0).length;
    const down = items.filter((i) => (i.ret20d ?? 0) < 0).length;
    const flat = items.length - up - down;
    const avgRet = items.reduce((sum, i) => sum + (i.ret20d ?? 0), 0) / items.length;
    const avgScore = items.reduce((sum, i) => sum + (i.score ?? 0), 0) / items.length;
    const highScores = items.filter((i) => (i.score ?? 0) >= 70).length;
    const upPct = (up / items.length) * 100;
    return { up, down, flat, avgRet, avgScore, highScores, upPct };
  }, [items]);

  const pageCount = Math.max(1, Math.ceil(total / 25));

  return (
    <div className={`app-root ${theme}`}>
      <main className="app-shell">
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
              <span className="b-label">当前池平均20日涨幅</span>
              <span className={`b-val ${marketStats.avgRet >= 0 ? "positive" : "negative"}`}>
                {formatPercent(marketStats.avgRet)}
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
            onClick={() => setNavTab("screener")}
          >
            🔍 选股大盘
          </button>
          <button
            className={navTab === "heatmap" ? "nav-item active" : "nav-item"}
            onClick={() => setNavTab("heatmap")}
          >
            🔥 市场全景热力图
          </button>
          <button
            className={navTab === "recommendations" ? "nav-item active" : "nav-item"}
            onClick={() => setNavTab("recommendations")}
          >
            🏆 每日量化精选 ({recommendations.length > 0 ? recommendations.length : "Top 10"})
          </button>
          <button
            className={navTab === "rules" ? "nav-item active" : "nav-item"}
            onClick={() => setNavTab("rules")}
          >
            ⚙️ 规则选股 / AI 策略
          </button>
          <button
            className={navTab === "watchlist" ? "nav-item active" : "nav-item"}
            onClick={() => setNavTab("watchlist")}
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
          <MarketHeatmapView
            items={marketHeatmapItems}
            onSelectStock={(item) => handleSelectStock(item, false)}
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
                  const asScreenerItems: ScreenerItem[] = watchlist.map((w) => ({
                    code: w.code,
                    name: w.name,
                    instrumentType: "stock",
                    isSt: false,
                    tradeDate: w.latestTradeDate,
                    quoteDate: null,
                    quoteTime: null,
                    quoteSource: null,
                    close: w.latestClose,
                    score: w.scoreTotal,
                    dataCompleteness: 1,
                    market: null,
                    industry: null,
                    pctChange: null,
                    turnoverRate: null,
                    ret5d: null,
                    ret20d: w.tracking.returnPct,
                    ret60d: null,
                    ma20Slope: null,
                    volumeRatio20: null,
                    volatility20: null,
                  }));
                  exportToCsv(asScreenerItems, "我的自选池.csv");
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
                  void api.screener({ code, page: 1, pageSize: 1 }).then((res) => {
                    if (res.items.length) handleSelectStock(res.items[0], false);
                  });
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
                {formatPercent(item.ret20d)}
              </td>
              <td>{formatNumber(item.turnoverRate)}%</td>
              <td>{formatNumber(item.volatility20)}</td>
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
function MarketHeatmapView({
  items,
  onSelectStock,
}: {
  items: ScreenerItem[];
  onSelectStock: (item: ScreenerItem) => void;
}) {
  const [heatmapType, setHeatmapType] = useState<"sectors" | "tradingview">("sectors");
  const [metricType, setMetricType] = useState<"ret20" | "score">("ret20");

  const sectors = useMemo(() => {
    const map = new Map<string, ScreenerItem[]>();
    for (const item of items) {
      const ind = item.industry || (item.code.startsWith("5") || item.code.startsWith("1") ? "ETF基金" : "其他主板");
      if (!map.has(ind)) map.set(ind, []);
      map.get(ind)!.push(item);
    }
    return Array.from(map.entries()).map(([industry, stocks]) => {
      const avgRet =
        stocks.reduce((sum, s) => sum + (s.ret20d ?? 0), 0) / (stocks.length || 1);
      const avgScore =
        stocks.reduce((sum, s) => sum + (s.score ?? 50), 0) / (stocks.length || 1);
      return { industry, stocks, avgRet, avgScore };
    }).sort((a, b) => b.stocks.length - a.stocks.length);
  }, [items]);

  function getTileBg(ret: number | null): string {
    if (ret === null) return "#64748b";
    if (ret >= 15) return "#b91c1c";
    if (ret >= 8) return "#dc2626";
    if (ret >= 3) return "#ef4444";
    if (ret > 0) return "#f87171";
    if (ret === 0) return "#94a3b8";
    if (ret <= -15) return "#15803d";
    if (ret <= -8) return "#16a34a";
    if (ret <= -3) return "#22c55e";
    return "#4ade80";
  }

  function getScoreBg(score: number | null): string {
    if (score === null) return "#64748b";
    if (score >= 85) return "#047857";
    if (score >= 70) return "#059669";
    if (score >= 50) return "#10b981";
    if (score >= 35) return "#d97706";
    return "#dc2626";
  }

  return (
    <section className="view-container heatmap-view">
      <div className="section-heading">
        <div>
          <h2>A 股全景热力图</h2>
          <span>直观洞察板块冷热格局、资金聚焦行业与强势龙头</span>
        </div>
        <div className="heatmap-controls">
          <div className="toggle-group">
            <button
              className={heatmapType === "sectors" ? "toggle-btn active" : "toggle-btn"}
              onClick={() => setHeatmapType("sectors")}
            >
              📊 量化板块热力图
            </button>
            <button
              className={heatmapType === "tradingview" ? "toggle-btn active" : "toggle-btn"}
              onClick={() => setHeatmapType("tradingview")}
            >
              🌐 TradingView 云端热力图
            </button>
          </div>

          {heatmapType === "sectors" && (
            <div className="toggle-group">
              <button
                className={metricType === "ret20" ? "toggle-btn active" : "toggle-btn"}
                onClick={() => setMetricType("ret20")}
              >
                按 20日涨跌
              </button>
              <button
                className={metricType === "score" ? "toggle-btn active" : "toggle-btn"}
                onClick={() => setMetricType("score")}
              >
                按 量化评分
              </button>
            </div>
          )}
        </div>
      </div>

      {heatmapType === "sectors" ? (
        <div className="sectors-heatmap-grid">
          {sectors.map((sec) => (
            <div key={sec.industry} className="sector-block">
              <div className="sector-header">
                <strong>{sec.industry}</strong>
                <span className={sec.avgRet >= 0 ? "positive" : "negative"}>
                  {metricType === "ret20" ? formatPercent(sec.avgRet) : `均分: ${sec.avgScore.toFixed(1)}`}
                </span>
              </div>
              <div className="stock-tiles-container">
                {sec.stocks.map((stk) => {
                  const bg = metricType === "ret20" ? getTileBg(stk.ret20d) : getScoreBg(stk.score);
                  return (
                    <div
                      key={stk.code}
                      className="stock-heat-tile"
                      style={{ backgroundColor: bg }}
                      onClick={() => onSelectStock(stk)}
                      title={`${stk.name} (${stk.code})\n价格: ¥${stk.close}\n20日涨幅: ${formatPercent(stk.ret20d)}\n综合得分: ${stk.score}`}
                    >
                      <span className="tile-name">{stk.name}</span>
                      <span className="tile-metric">
                        {metricType === "ret20" ? formatPercent(stk.ret20d) : formatNumber(stk.score, 1)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="tv-heatmap-frame">
          <iframe
            title="TradingView Market Heatmap"
            src="https://s.tradingview.com/embed-widget/stock-heatmap/?locale=zh_CN#%7B%22dataSource%22%3A%22China%22%2C%22blockSize%22%3A%22market_cap_basic%22%2C%22blockColor%22%3A%22change%22%2C%22grouping%22%3A%22sector%22%2C%22theme%22%3A%22light%22%2C%22hasTopBar%22%3Atrue%2C%22isDataSetEnabled%22%3Atrue%7D"
            className="full-tv-iframe"
          />
        </div>
      )}
    </section>
  );
}

/** ------------------- RECOMMENDATIONS COMPONENT ------------------- */
function RecommendationsView({
  recommendations,
  screenerItems,
  user,
  watchlist,
  onAdd,
  onSelectStock,
}: {
  recommendations: Recommendation[];
  screenerItems: ScreenerItem[];
  user: User | null;
  watchlist: WatchlistItem[];
  onAdd: (code: string) => Promise<void>;
  onSelectStock: (item: ScreenerItem) => void;
}) {
  const displayItems = useMemo(() => {
    if (recommendations.length > 0) {
      return recommendations.map((r) => ({
        code: r.code,
        name: r.name,
        rank: r.rank,
        score: r.score,
        referenceClose: r.referenceClose,
        referenceDate: r.referenceTradeDate,
        latestClose: r.latestClose,
        returnPct: r.tracking.returnPct,
        screenerItem: screenerItems.find((s) => s.code === r.code) || {
          code: r.code,
          name: r.name,
          instrumentType: r.code.startsWith("5") || r.code.startsWith("1") ? "etf" : "stock",
          isSt: false,
          tradeDate: r.latestTradeDate,
          quoteDate: null,
          quoteTime: null,
          quoteSource: null,
          close: r.latestClose,
          score: r.score,
          dataCompleteness: 1,
          market: r.code.startsWith("6") ? "SH" : "SZ",
          industry: "推荐标的",
          pctChange: null,
          turnoverRate: null,
          ret5d: null,
          ret20d: null,
          ret60d: null,
          ma20Slope: null,
          volumeRatio20: null,
          volatility20: null,
        },
      }));
    }

    const top = [...screenerItems].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 10);
    return top.map((s, idx) => ({
      code: s.code,
      name: s.name,
      rank: idx + 1,
      score: s.score ?? 0,
      referenceClose: s.close ?? 0,
      referenceDate: s.tradeDate,
      latestClose: s.close,
      returnPct: s.ret20d,
      screenerItem: s,
    }));
  }, [recommendations, screenerItems]);

  return (
    <section className="view-container recommendations-view">
      <div className="section-heading">
        <div>
          <h2>🏆 每日量化精选 Top 10 推荐池</h2>
          <span>多因子评分模型每日收盘后筛选出的最具多头潜力的核心标的（不可篡改基准价，真实跟踪）</span>
        </div>
      </div>

      <div className="recommendations-grid">
        {displayItems.map((rec) => {
          const isWatch = watchlist.some((w) => w.code === rec.code);
          return (
            <div
              key={rec.code}
              className="rec-card clickable-row"
              onClick={() => onSelectStock(rec.screenerItem)}
            >
              <div className="rec-badge-wrap">
                <span className={`rank-badge rank-${rec.rank <= 3 ? rec.rank : "normal"}`}>
                  Top {rec.rank}
                </span>
                <span className="rec-score-pill">得分: {formatNumber(rec.score, 1)}</span>
              </div>

              <div className="rec-stock-title">
                <h3>{rec.name}</h3>
                <span className="rec-code">{rec.code}</span>
              </div>

              <div className="rec-data-grid">
                <div className="rec-data-cell">
                  <span className="label">推荐基准价</span>
                  <span className="val">¥ {formatNumber(rec.referenceClose)}</span>
                </div>
                <div className="rec-data-cell">
                  <span className="label">最新价</span>
                  <span className="val">¥ {formatNumber(rec.latestClose)}</span>
                </div>
                <div className="rec-data-cell">
                  <span className="label">跟踪收益率</span>
                  <span className={`val ${rec.returnPct !== null && rec.returnPct < 0 ? "negative" : "positive"}`}>
                    {formatPercent(rec.returnPct)}
                  </span>
                </div>
              </div>

              <div className="rec-reasons">
                <span className="reason-tag">📈 均线多头</span>
                <span className="reason-tag">⚡ 动量领先</span>
                <span className="reason-tag">🛡️ 波动可控</span>
              </div>

              <div className="rec-card-footer" onClick={(e) => e.stopPropagation()}>
                <button
                  className={`small-button ${isWatch ? "secondary-button" : "primary-button"}`}
                  onClick={() => void onAdd(rec.code)}
                >
                  {isWatch ? "★ 已在自选" : user ? "+ 加自选" : "登录自选"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** ------------------- CUSTOM RULE SCREENER COMPONENT ------------------- */
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
  const [matchedItems, setMatchedItems] = useState<ScreenerItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jsonInput, setJsonInput] = useState("");
  const [promptCopied, setPromptCopied] = useState(false);
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
  const aiGenerationPrompt = `请将下面的选股想法转换为本系统支持的 JSON，不要输出 Markdown、解释或任何额外文字。\n\n输出结构：{ "logic": "AND" | "OR", "excludeSt": true | false, "sortBy": "score" | "price" | "ret20" | "turnover" | "volatility", "sortDirection": "asc" | "desc", "conditions": [{ "field": string, "op": string, "value": number|string }] }\n\n所有数值字段的 value 必须是数字，op 只能是 >、>=、<、<=、==、!=。技术字段：score；ret5d/ret20d/ret60d/ret120d/ret250d；ma20Slope；volumeRatio5/volumeRatio20；amount/amountRatio5/amountRatio20（元/比值）；rsi14（0-100）；volatility20/volatility60；maxDrawdown60；distanceHigh20/distanceHigh60/distanceHigh250/distanceLow250；pricePercentile250（0-1）；turnoverRate；close。\n\n资金字段（元或百分比）：mainNetInflow、mainNetInflowPct、superLargeNetInflow、largeNetInflow、mediumNetInflow、smallNetInflow、mainNetInflow3d、mainNetInflow5d、mainNetInflow10d。\n\n估值字段：peTtm（市盈率 TTM）、pb（市净率）、totalMarketCap（总市值，元）、floatMarketCap（流通市值，元）。财务字段（百分比或元）：roe、revenueYoy、profitYoy、grossMargin、debtRatio、revenue、netProfit。\n\n文本字段：industry=所属行业；market=市场。文本 value 必须非空，op 只能是 contains、==、!=。conditions 至少 1 条、最多 20 条；AND 表示全部满足，OR 表示任一满足。不要使用未列出的字段、运算符、括号、嵌套对象、自然语言条件或空值。\n\n示例：{"logic":"AND","excludeSt":true,"sortBy":"score","sortDirection":"desc","conditions":[{"field":"roe","op":">=","value":12},{"field":"profitYoy","op":">=","value":20},{"field":"mainNetInflow5d","op":">=","value":100000000}]}`;
  const addCondition = () => { if (conditions.length < 20) setConditions([...conditions, { field: "ret20d", op: ">=", value: 0 }]); };
  function updateCondition(index: number, update: Partial<RuleCondition>) {
    setConditions(conditions.map((condition, position) => {
      if (position !== index) return condition;
      const next = { ...condition, ...update };
      if (update.field) { const numeric = fieldMeta(update.field).numeric; next.op = numeric ? ">=" : "contains"; next.value = numeric ? 0 : ""; }
      return next;
    }));
  }
  async function runScreener() {
    setLoading(true); setError(null);
    try { const result = await api.ruleScreener({ logic, conditions, excludeSt, sortBy, sortDirection, page: 1, pageSize: 100 }); setMatchedItems(result.items); setTotal(result.total); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "规则选股执行失败。"); setMatchedItems([]); setTotal(null); }
    finally { setLoading(false); }
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
            <select value={condition.field} onChange={(event) => updateCondition(index, { field: event.target.value as RuleCondition["field"] })}>{fields.map((field) => <option key={field.value} value={field.value}>{field.label}</option>)}</select>
            <select value={condition.op} onChange={(event) => updateCondition(index, { op: event.target.value as RuleCondition["op"] })}>{options.map((op) => <option key={op} value={op}>{op === "contains" ? "包含" : op}</option>)}</select>
            <input type={meta.numeric ? "number" : "text"} value={condition.value} step="any" placeholder={meta.numeric ? "请输入数值" : "如：半导体"} onChange={(event) => updateCondition(index, { value: meta.numeric ? Number(event.target.value) : event.target.value })} />
            <button className="text-button clear-btn" disabled={conditions.length === 1} onClick={() => setConditions(conditions.filter((_, position) => position !== index))}>删除</button>
          </div>;
        })}
        <div className="rule-editor-actions">
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
            <span>{total === null ? "请先配置并执行选股条件" : `共找到 ${total} 只符合条件的标的`}</span>
          </div>
        </div>

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
function StockDetailPage({
  stock,
  user,
  theme,
  isFullScreen,
  isWatchlisted,
  onAdd,
  onToggleFullScreen,
  onClose,
}: {
  stock: ScreenerItem;
  user: User | null;
  theme: "light" | "dark";
  isFullScreen: boolean;
  isWatchlisted: boolean;
  onAdd: (code: string) => Promise<void>;
  onToggleFullScreen: () => void;
  onClose: () => void;
}) {
  const [chartInterval, setChartInterval] = useState<"D" | "W" | "60" | "15">("D");
  const [activeDetailTab, setActiveDetailTab] = useState<"chart" | "quant" | "f10">("chart");

  const isSh = stock.code.startsWith("6") || stock.code.startsWith("5");
  const marketPrefix = isSh ? "SH" : "SZ";
  const tvSymbol = isSh ? `SSE:${stock.code}` : `SZSE:${stock.code}`;

  const eastmoneyUrl = isSh
    ? `https://quote.eastmoney.com/concept/sh${stock.code}.html`
    : `https://quote.eastmoney.com/concept/sz${stock.code}.html`;
  const xueqiuUrl = `https://xueqiu.com/S/${marketPrefix}${stock.code}`;
  const fundFlowUrl = `https://data.eastmoney.com/zjlx/${stock.code}.html`;
  const thsUrl = `https://stockpage.10jqka.com.cn/${stock.code}/`;
  const sinaUrl = `https://finance.sina.com.cn/realstock/company/${marketPrefix.toLowerCase()}${stock.code}/nc.shtml`;

  const trendDesc =
    stock.ma20Slope !== null && stock.ma20Slope > 0.02
      ? "20日均线呈强劲向上发散形态，处于多头上升趋势。"
      : stock.ma20Slope !== null && stock.ma20Slope < -0.02
      ? "20日均线呈向下开口形态，处于空头调整波段。"
      : "20日均线走平，处于区间震荡整理阶段。";

  const momentumDesc =
    stock.ret20d !== null && stock.ret20d > 10
      ? "近20个交易日动量强劲，跑赢大盘基准。"
      : stock.ret20d !== null && stock.ret20d < -10
      ? "近20日跌幅较大，短线超跌或处于弱势动量区。"
      : "近20日动量适中，跟随大盘平稳波动。";

  const volumeDesc =
    stock.volumeRatio20 !== null && stock.volumeRatio20 > 1.3
      ? "量比明显放大，主力资金介入与换手活跃度高。"
      : stock.volumeRatio20 !== null && stock.volumeRatio20 < 0.8
      ? "缩量成交，市场交投相对清淡。"
      : "成交量维持在正常滚动均量水平。";

  const riskDesc =
    stock.volatility20 !== null && stock.volatility20 < 0.25
      ? "年化波动率较低，属于低波动稳健型标的。"
      : "年化波动率较高，属于弹性较大博弈型标的。";

  const tvTheme = theme === "dark" ? "dark" : "light";

  return (
    <div className={`detail-page-backdrop ${isFullScreen ? "fullscreen" : "drawer"}`} onClick={onClose}>
      <article className="detail-container" onClick={(e) => e.stopPropagation()}>
        {/* Top Navigation Bar */}
        <header className="detail-header">
          <div className="stock-title-wrap">
            <h2>
              {stock.name} <span className="code-tag">{stock.code}</span>
            </h2>
            <div className="stock-tags">
              <span className="tag market-tag">{stock.market === "SH" ? "上海证券交易所" : "深圳证券交易所"}</span>
              <span className="tag industry-tag">{stock.industry || "主板 / ETF 标的"}</span>
              <span className="tag date-tag">基准日: {stock.tradeDate}</span>
              {stock.quoteDate && (
                <span className="tag date-tag">行情日: {marketDate(stock)}{stock.quoteTime ? ` ${stock.quoteTime}` : ""}</span>
              )}
            </div>
          </div>
          <div className="header-controls">
            <button className="icon-btn" onClick={onToggleFullScreen} title={isFullScreen ? "还原窗口" : "全屏详情页"}>
              {isFullScreen ? "🗗 窗口" : "⛶ 全屏"}
            </button>
            <button className="icon-btn close-btn" onClick={onClose} title="关闭">
              ✕
            </button>
          </div>
        </header>

        {/* Highlight Price & Score Bar */}
        <section className="key-metrics-banner">
          <div className="metric-cell">
            <span className="metric-label">最新收盘价</span>
            <span className="metric-num price-val">¥ {formatNumber(stock.close)}</span>
          </div>
          <div className="metric-cell">
            <span className="metric-label">20日收益率</span>
            <span className={`metric-num ${stock.ret20d !== null && stock.ret20d < 0 ? "negative" : "positive"}`}>
              {formatPercent(stock.ret20d)}
            </span>
          </div>
          <div className="metric-cell">
            <span className="metric-label">换手率</span>
            <span className="metric-num">{formatNumber(stock.turnoverRate)}%</span>
          </div>
          <div className="metric-cell">
            <span className="metric-label">20日年化波动率</span>
            <span className="metric-num">{formatNumber(stock.volatility20)}</span>
          </div>
          <div className="metric-cell score-cell">
            <span className="metric-label">量化综合评分</span>
            <span className="metric-num score-val">{formatNumber(stock.score, 1)} <span className="score-unit">分</span></span>
          </div>
        </section>

        {/* View Switcher Tabs */}
        <nav className="detail-view-tabs">
          <button
            className={activeDetailTab === "chart" ? "view-tab active" : "view-tab"}
            onClick={() => setActiveDetailTab("chart")}
          >
            📈 交互式专业 K 线图
          </button>
          <button
            className={activeDetailTab === "quant" ? "view-tab active" : "view-tab"}
            onClick={() => setActiveDetailTab("quant")}
          >
            🎯 量化多因子与智能诊断
          </button>
          <button
            className={activeDetailTab === "f10" ? "view-tab active" : "view-tab"}
            onClick={() => setActiveDetailTab("f10")}
          >
            📑 全网 F10 与资金流直达
          </button>
        </nav>

        {/* Tab 1: Interactive K-Line Chart */}
        {activeDetailTab === "chart" && (
          <section className="chart-view-section">
            <div className="chart-toolbar">
              <span className="toolbar-label">周期选择：</span>
              <div className="interval-buttons">
                <button
                  className={chartInterval === "D" ? "interval-btn active" : "interval-btn"}
                  onClick={() => setChartInterval("D")}
                >
                  日 K
                </button>
                <button
                  className={chartInterval === "W" ? "interval-btn active" : "interval-btn"}
                  onClick={() => setChartInterval("W")}
                >
                  周 K
                </button>
                <button
                  className={chartInterval === "60" ? "interval-btn active" : "interval-btn"}
                  onClick={() => setChartInterval("60")}
                >
                  60 分钟
                </button>
                <button
                  className={chartInterval === "15" ? "interval-btn active" : "interval-btn"}
                  onClick={() => setChartInterval("15")}
                >
                  15 分钟
                </button>
              </div>
              <span className="chart-source-tip">由 TradingView 云端引擎提供实时图表渲染（0 存储 0 延时）</span>
            </div>
            <div className="main-chart-frame">
              <iframe
                title="TradingView Realtime Chart"
                src={`https://s.tradingview.com/widgetembed/?frameElementId=tradingview_widget&symbol=${tvSymbol}&interval=${chartInterval}&hidesidetoolbar=0&symboledit=1&saveimage=1&toolbarbg=${theme === "dark" ? "1e293b" : "f1f3f6"}&theme=${tvTheme}&style=1&timezone=Asia%2FShanghai&locale=zh_CN`}
                className="full-tv-iframe"
              />
            </div>
          </section>
        )}

        {/* Tab 2: Quant Factor Diagnostics */}
        {activeDetailTab === "quant" && (
          <section className="quant-view-section">
            <h3>多维度因子明细与智能诊断</h3>
            <div className="diagnostic-cards">
              <div className="diag-card">
                <div className="diag-card-header">
                  <span className="diag-icon">📈</span>
                  <strong>趋势维度 (Trend)</strong>
                  <span className="diag-val">{formatPercent(stock.ma20Slope)}</span>
                </div>
                <p className="diag-text">{trendDesc}</p>
              </div>

              <div className="diag-card">
                <div className="diag-card-header">
                  <span className="diag-icon">⚡</span>
                  <strong>动量维度 (Momentum)</strong>
                  <span className="diag-val">{formatPercent(stock.ret20d)}</span>
                </div>
                <p className="diag-text">{momentumDesc}</p>
              </div>

              <div className="diag-card">
                <div className="diag-card-header">
                  <span className="diag-icon">📊</span>
                  <strong>量价活跃度 (Volume-Price)</strong>
                  <span className="diag-val">{formatNumber(stock.volumeRatio20)}</span>
                </div>
                <p className="diag-text">{volumeDesc}</p>
              </div>

              <div className="diag-card">
                <div className="diag-card-header">
                  <span className="diag-icon">🛡️</span>
                  <strong>风险与波动 (Risk)</strong>
                  <span className="diag-val">{formatNumber(stock.volatility20)}</span>
                </div>
                <p className="diag-text">{riskDesc}</p>
              </div>
            </div>

            <div className="factors-table-wrap">
              <h4>技术指标清单</h4>
              <div className="factor-grid-full">
                <div className="factor-pill">
                  <span>5日累计收益</span>
                  <strong>{formatPercent(stock.ret5d)}</strong>
                </div>
                <div className="factor-pill">
                  <span>20日累计收益</span>
                  <strong>{formatPercent(stock.ret20d)}</strong>
                </div>
                <div className="factor-pill">
                  <span>60日累计收益</span>
                  <strong>{formatPercent(stock.ret60d)}</strong>
                </div>
                <div className="factor-pill">
                  <span>20日均线斜率</span>
                  <strong>{formatPercent(stock.ma20Slope)}</strong>
                </div>
                <div className="factor-pill">
                  <span>20日平均量比</span>
                  <strong>{formatNumber(stock.volumeRatio20)}</strong>
                </div>
                <div className="factor-pill">
                  <span>20日年化波动率</span>
                  <strong>{formatNumber(stock.volatility20)}</strong>
                </div>
                <div className="factor-pill">
                  <span>横截面综合得分</span>
                  <strong className="score-val">{formatNumber(stock.score, 1)}</strong>
                </div>
                <div className="factor-pill">
                  <span>数据有效性完整度</span>
                  <strong>{stock.dataCompleteness ? `${(stock.dataCompleteness * 100).toFixed(0)}%` : "-"}</strong>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Tab 3: External Research Links */}
        {activeDetailTab === "f10" && (
          <section className="research-view-section">
            <h3>全网权威资料一键深度调研</h3>
            <p className="research-sub">
              结合各大主流专业金融机构的 F10、财务报表、资金流向及社区研报：
            </p>
            <div className="deep-research-links-grid">
              <a href={eastmoneyUrl} target="_blank" rel="noreferrer" className="portal-card">
                <div className="portal-icon">📊</div>
                <div className="portal-info">
                  <strong>东方财富 F10 深度资料</strong>
                  <span>查看资产负债表、利润表、分红派息、高管持股与十大股东</span>
                </div>
                <span className="arrow">↗</span>
              </a>

              <a href={fundFlowUrl} target="_blank" rel="noreferrer" className="portal-card">
                <div className="portal-icon">💰</div>
                <div className="portal-info">
                  <strong>东方财富主力资金流向</strong>
                  <span>查看当日与近期超大单、大单、中单、散户净流入占比</span>
                </div>
                <span className="arrow">↗</span>
              </a>

              <a href={xueqiuUrl} target="_blank" rel="noreferrer" className="portal-card">
                <div className="portal-icon">💬</div>
                <div className="portal-info">
                  <strong>雪球个股讨论与机构研报</strong>
                  <span>汇聚买方/卖方深度研报、大V深度逻辑剖析与实时互动</span>
                </div>
                <span className="arrow">↗</span>
              </a>

              <a href={thsUrl} target="_blank" rel="noreferrer" className="portal-card">
                <div className="portal-icon">📈</div>
                <div className="portal-info">
                  <strong>同花顺筹码分布与股东分析</strong>
                  <span>查看获利盘比例、股东户数增减、机构持仓变动与龙虎榜</span>
                </div>
                <span className="arrow">↗</span>
              </a>

              <a href={sinaUrl} target="_blank" rel="noreferrer" className="portal-card">
                <div className="portal-icon">⚡</div>
                <div className="portal-info">
                  <strong>新浪财经实时买卖五档</strong>
                  <span>即时 Level-1 盘口买卖队列与实时分笔明细</span>
                </div>
                <span className="arrow">↗</span>
              </a>
            </div>
          </section>
        )}

        {/* Footer Action Bar */}
        <footer className="detail-footer">
          <div className="footer-left">
            <span className="tip">💡 提示：按 ESC 键或点击右上角 ✕ 即可返回</span>
          </div>
          <div className="footer-right">
            <button
              className={isWatchlisted ? "secondary-button" : "primary-button"}
              onClick={() => void onAdd(stock.code)}
            >
              {isWatchlisted ? "★ 已在自选池中" : user ? "+ 加入自选池" : "登录后加入自选"}
            </button>
          </div>
        </footer>
      </article>
    </div>
  );
}
