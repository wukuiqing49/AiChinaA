import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { api, DataRefresh, MarketIndexItem, Recommendation, ScreenerItem, ScreenerQuery, User, WatchlistItem } from "./api";
import { parseAndEvaluateRules, RULE_TEMPLATES, RuleParseResult } from "./ruleParser";
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

  useEffect(() => {
    void loadUser();
    void loadScreen(emptyFilters, 1);
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
      void loadRecommendations();
      void loadMarketIndices();
      void loadRefresh();
    }, 120000);

    return () => clearInterval(timer);
  }, [filters, loadMarketIndices, loadRecommendations, loadRefresh, loadScreen, loadUser, page]);

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
            items={items}
            onSelectStock={(item) => handleSelectStock(item, false)}
          />
        )}

        {/* VIEW 3: RECOMMENDATIONS (每日量化精选推荐) */}
        {navTab === "recommendations" && (
          <RecommendationsView
            recommendations={recommendations}
            screenerItems={items}
            user={user}
            watchlist={watchlist}
            onAdd={addToWatchlist}
            onSelectStock={(item) => handleSelectStock(item, false)}
          />
        )}

        {/* VIEW 4: CUSTOM RULE SCREENER (规则选股 / AI 策略) */}
        {navTab === "rules" && (
          <CustomRuleScreenerView
            items={items}
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
  items,
  user,
  onAdd,
  onSelectStock,
  onOpenFull,
}: {
  items: ScreenerItem[];
  user: User | null;
  onAdd: (code: string) => Promise<void>;
  onSelectStock: (item: ScreenerItem) => void;
  onOpenFull: (item: ScreenerItem) => void;
}) {
  const [ruleInput, setRuleInput] = useState<string>(RULE_TEMPLATES[0].code);
  const [parseResult, setParseResult] = useState<RuleParseResult>(() =>
    parseAndEvaluateRules(RULE_TEMPLATES[0].code, items)
  );
  const [copied, setCopied] = useState(false);

  function handleEvaluate(input = ruleInput) {
    const result = parseAndEvaluateRules(input, items);
    setParseResult(result);
  }

  function handleSelectTemplate(code: string) {
    setRuleInput(code);
    handleEvaluate(code);
  }

  function handleCopy() {
    void navigator.clipboard.writeText(ruleInput);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="view-container rule-screener-view">
      <div className="section-heading">
        <div>
          <h2>⚙️ 外部规则选股 & AI 策略解析器</h2>
          <span>将外部 ChatGPT / DeepSeek 生成的量化条件、JSON 或算式粘贴在此，即刻解析并执行全市场筛选</span>
        </div>
        <button
          className="secondary-button export-btn"
          onClick={() => exportToCsv(parseResult.matchedItems, `策略选股_${parseResult.strategyName}.csv`)}
        >
          📥 导出策略结果为 CSV
        </button>
      </div>

      {/* Preset Strategy Buttons */}
      <div className="rule-presets-bar">
        <span className="preset-label">快速套用经典模板：</span>
        <div className="preset-buttons">
          {RULE_TEMPLATES.map((tmpl) => (
            <button
              key={tmpl.name}
              className="preset-btn"
              onClick={() => handleSelectTemplate(tmpl.code)}
            >
              {tmpl.name}
            </button>
          ))}
        </div>
      </div>

      {/* Rule Editor Textarea */}
      <div className="rule-editor-box">
        <textarea
          className="rule-textarea"
          value={ruleInput}
          onChange={(e) => setRuleInput(e.target.value)}
          placeholder="在此粘贴外部策略规则，支持算式（ret20d > 8 and ma20Slope > 0）、中文条件（20日涨幅 > 8 且 量比 > 1.2）或 JSON 格式..."
          rows={5}
        />
        <div className="rule-editor-actions">
          <button className="primary-button" onClick={() => handleEvaluate()}>
            ⚡ 解析并执行规则筛选
          </button>
          <button className="secondary-button" onClick={handleCopy}>
            {copied ? "✓ 已复制到剪贴板" : "📋 复制当前规则"}
          </button>
          <button className="text-button clear-btn" onClick={() => { setRuleInput(""); handleEvaluate(""); }}>
            清空
          </button>
        </div>
      </div>

      {/* Smart Strategy Diagnostic Card */}
      <div className="strategy-analysis-card">
        <div className="analysis-header">
          <div className="analysis-title">
            <span className="analysis-icon">🧠</span>
            <strong>AI 策略解析诊断</strong>
            <span className="strategy-tag">{parseResult.strategyName}</span>
          </div>
          <div className="match-stats-pill">
            命中标的：<strong>{parseResult.matchedItems.length}</strong> / {items.length} 
            <span className="rate">({(parseResult.matchRate * 100).toFixed(1)}% 命中率)</span>
          </div>
        </div>

        <p className="analysis-desc">{parseResult.description}</p>

        {parseResult.conditions.length > 0 && (
          <div className="conditions-tags-wrap">
            <span className="tags-label">生效的约束条件：</span>
            <div className="tags-list">
              {parseResult.conditions.map((c, i) => (
                <span key={i} className="cond-pill">
                  {c.fieldLabel} <strong>{c.op} {c.value}</strong>
                </span>
              ))}
            </div>
          </div>
        )}

        {parseResult.errors.length > 0 && (
          <div className="parse-errors">
            {parseResult.errors.map((err, i) => (
              <p key={i} className="error-tip">⚠️ {err}</p>
            ))}
          </div>
        )}
      </div>

      {/* Results Table */}
      <div className="screener-results-wrap">
        <div className="section-heading">
          <div>
            <h3>策略匹配结果清单</h3>
            <span>共找到 {parseResult.matchedItems.length} 只符合该策略的标的</span>
          </div>
        </div>

        <ScreenerTable
          items={parseResult.matchedItems}
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
