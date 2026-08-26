import { FormEvent, useCallback, useEffect, useState } from "react";

import { api, ScreenerItem, ScreenerQuery, User, WatchlistItem } from "./api";
import "./styles.css";

type FilterState = Omit<ScreenerQuery, "page" | "pageSize">;

const emptyFilters: FilterState = {
  code: "",
  name: "",
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

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [items, setItems] = useState<ScreenerItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(false);

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
  }, [loadScreen, loadUser]);

  async function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    await loadScreen(filters, 1);
  }

  async function resetFilters() {
    setFilters(emptyFilters);
    await loadScreen(emptyFilters, 1);
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

  const pageCount = Math.max(1, Math.ceil(total / 25));

  return (
    <main className="app-shell">
      <header>
        <div>
          <p className="eyebrow">个人研究工作台</p>
          <h1>A 股筛选工作台</h1>
        </div>
        {user ? (
          <div className="account-actions"><span>{user.displayName ?? user.username}</span><button className="text-button" onClick={() => void api.logout().then(loadUser)}>退出</button></div>
        ) : <button className="text-button" onClick={() => setShowLogin((visible) => !visible)}>{showLogin ? "关闭登录" : "账户登录"}</button>}
      </header>

      {showLogin && !user && <LoginPanel onSuccess={async () => { await loadUser(); setShowLogin(false); }} />}
      {error && <p className="error">{error}</p>}

      <section className="screener-panel" aria-label="股票筛选条件">
        <div className="section-heading"><div><h2>筛选条件</h2><span>仅展示已发布的最新数据</span></div><span>{asOf ? `数据日期：${asOf}` : "暂无数据日期"}</span></div>
        <form className="filter-form" onSubmit={submitFilters}>
          <FilterInput label="代码" value={filters.code ?? ""} onChange={(value) => setFilters({ ...filters, code: value })} placeholder="600519" />
          <FilterInput label="名称" value={filters.name ?? ""} onChange={(value) => setFilters({ ...filters, name: value })} placeholder="贵州茅台" />
          <label>市场<select value={filters.market} onChange={(event) => setFilters({ ...filters, market: event.target.value })}><option value="">全部</option><option value="SH">沪市</option><option value="SZ">深市</option><option value="BJ">北交所</option></select></label>
          <FilterInput label="行业" value={filters.industry ?? ""} onChange={(value) => setFilters({ ...filters, industry: value })} placeholder="行业名称" />
          <FilterInput label="最低价格" value={filters.minPrice ?? ""} onChange={(value) => setFilters({ ...filters, minPrice: value })} type="number" />
          <FilterInput label="最高价格" value={filters.maxPrice ?? ""} onChange={(value) => setFilters({ ...filters, maxPrice: value })} type="number" />
          <FilterInput label="20日最低涨幅 %" value={filters.minRet20 ?? ""} onChange={(value) => setFilters({ ...filters, minRet20: value })} type="number" />
          <FilterInput label="20日最高涨幅 %" value={filters.maxRet20 ?? ""} onChange={(value) => setFilters({ ...filters, maxRet20: value })} type="number" />
          <FilterInput label="最低换手率 %" value={filters.minTurnover ?? ""} onChange={(value) => setFilters({ ...filters, minTurnover: value })} type="number" />
          <FilterInput label="最高波动率" value={filters.maxVolatility ?? ""} onChange={(value) => setFilters({ ...filters, maxVolatility: value })} type="number" />
          <FilterInput label="最低技术分" value={filters.minScore ?? ""} onChange={(value) => setFilters({ ...filters, minScore: value })} type="number" />
          <label>排序<select value={filters.sortBy} onChange={(event) => setFilters({ ...filters, sortBy: event.target.value })}><option value="score">综合分</option><option value="ret20">20日涨幅</option><option value="turnover">换手率</option><option value="price">价格</option><option value="volatility">波动率</option></select></label>
          <label>方向<select value={filters.sortDirection} onChange={(event) => setFilters({ ...filters, sortDirection: event.target.value })}><option value="desc">降序</option><option value="asc">升序</option></select></label>
          <div className="filter-actions"><button type="submit">{loading ? "筛选中..." : "开始筛选"}</button><button type="button" className="secondary-button" onClick={() => void resetFilters()}>重置</button></div>
        </form>
      </section>

      <section>
        <div className="section-heading"><div><h2>筛选结果</h2><span>共 {total} 只股票</span></div><span>第 {page} / {pageCount} 页</span></div>
        <ScreenerTable items={items} user={user} onAdd={addToWatchlist} />
        <div className="pagination"><button className="icon-button" title="上一页" disabled={page <= 1 || loading} onClick={() => void loadScreen(filters, page - 1)}>‹</button><span>{page} / {pageCount}</span><button className="icon-button" title="下一页" disabled={page >= pageCount || loading} onClick={() => void loadScreen(filters, page + 1)}>›</button></div>
      </section>

      {user && <section><div className="section-heading"><div><h2>我的自选</h2><span>从加入当天开始计算涨幅</span></div></div><WatchlistTable items={watchlist} onRemove={removeWatchlist} /></section>}
    </main>
  );
}

function FilterInput({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) {
  return <label>{label}<input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
}

function LoginPanel({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSubmitting(true); setError(null);
    try { await api.login(username, password); await onSuccess(); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "登录失败。"); } finally { setSubmitting(false); }
  }
  return <section className="login-panel"><form className="login-form" onSubmit={submit}><FilterInput label="用户名" value={username} onChange={setUsername} /><FilterInput label="密码" value={password} onChange={setPassword} type="password" /><div className="filter-actions"><button type="submit" disabled={submitting}>{submitting ? "登录中..." : "登录"}</button></div>{error && <p className="error">{error}</p>}</form></section>;
}

function ScreenerTable({ items, user, onAdd }: { items: ScreenerItem[]; user: User | null; onAdd: (code: string) => Promise<void> }) {
  if (!items.length) return <p className="empty">暂无符合条件的数据。请先完成数据发布，或放宽筛选条件。</p>;
  return <div className="table-wrap"><table><thead><tr><th>股票</th><th>市场/行业</th><th>价格</th><th>20日涨幅</th><th>换手率</th><th>波动率</th><th>技术分</th><th>数据日</th><th></th></tr></thead><tbody>{items.map((item) => <tr key={item.code}><td><strong>{item.name}</strong><small>{item.code}</small></td><td>{item.market ?? "-"}<small>{item.industry ?? "-"}</small></td><td>{formatNumber(item.close)}</td><td className={item.ret20d !== null && item.ret20d < 0 ? "negative" : "positive"}>{formatPercent(item.ret20d)}</td><td>{formatNumber(item.turnoverRate)}%</td><td>{formatNumber(item.volatility20)}</td><td>{formatNumber(item.score, 1)}<small>{item.dataCompleteness === null ? "-" : `${(item.dataCompleteness * 100).toFixed(0)}% 完整`}</small></td><td>{item.tradeDate}</td><td><button className="small-button" onClick={() => void onAdd(item.code)}>{user ? "加入自选" : "登录后自选"}</button></td></tr>)}</tbody></table></div>;
}

function WatchlistTable({ items, onRemove }: { items: WatchlistItem[]; onRemove: (code: string) => Promise<void> }) {
  if (!items.length) return <p className="empty">尚未加入自选股。</p>;
  return <div className="table-wrap"><table><thead><tr><th>股票</th><th>加入基准</th><th>最新收盘</th><th>观察涨幅</th><th></th></tr></thead><tbody>{items.map((item) => <tr key={item.code}><td><strong>{item.name}</strong><small>{item.code}</small></td><td>{item.observationTradeDate}<small>{formatNumber(item.observationClose)}</small></td><td>{formatNumber(item.latestClose)}<small>{item.latestTradeDate}</small></td><td className={item.tracking.returnPct !== null && item.tracking.returnPct < 0 ? "negative" : "positive"}>{formatPercent(item.tracking.returnPct)}</td><td><button className="icon-button" title="移除自选股" onClick={() => void onRemove(item.code)}>×</button></td></tr>)}</tbody></table></div>;
}
