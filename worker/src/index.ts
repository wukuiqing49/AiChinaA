import { getCookie, setCookie } from "hono/cookie";
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";

import { AuthError, createSession, verifyFixedCredentials, verifySession } from "./auth";
import { calculateObservationTracking } from "./tracking";
import { registerPublishing } from "./publishing";
import { registerMaintenance } from "./maintenance";
import { snapshotQuery, SnapshotUnavailable } from "./snapshot-query";
import type { Env, LatestStock, SessionUser } from "./types";

const app = new Hono<{ Bindings: Env }>();
const latestFullRunSql = "SELECT COALESCE((SELECT started_at FROM dataset_active WHERE dataset='screener'),(SELECT started_at FROM sync_runs WHERE status='completed' AND run_kind='full_market' ORDER BY completed_at DESC LIMIT 1))";

function normalizeSearchTerm(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu, "");
}
const addWatchlistSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
const loginSchema = z.object({
  username: z.string().regex(/^[A-Za-z0-9._-]{3,32}$/),
  password: z.string().min(8).max(256),
});
const refreshCallbackSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["running", "completed", "failed"]),
  tradeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  rowCount: z.number().int().min(0).optional(),
  error: z.string().max(500).optional(),
});
const screenerQuerySchema = z.object({
  code: z.string().regex(/^\d{1,6}$/).optional(),
  name: z.string().trim().max(40).optional(),
  instrumentType: z.enum(["stock", "etf"]).optional(),
  market: z.enum(["SH", "SZ", "BJ"]).optional(),
  industry: z.string().trim().max(80).optional(),
  minPrice: z.coerce.number().finite().min(0).optional(),
  maxPrice: z.coerce.number().finite().min(0).optional(),
  minRet20: z.coerce.number().finite().optional(),
  maxRet20: z.coerce.number().finite().optional(),
  minTurnover: z.coerce.number().finite().min(0).optional(),
  maxVolatility: z.coerce.number().finite().min(0).optional(),
  minScore: z.coerce.number().finite().min(0).max(100).optional(),
  snapshotId: z.string().regex(/^[A-Za-z0-9._-]{8,100}$/).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
  sortBy: z.enum(["score", "price", "ret20", "turnover", "volatility"]).default("score"),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
});

app.onError((error, context) => {
  const requestId=crypto.randomUUID();
  if (error instanceof SnapshotUnavailable) return context.json({error:error.message,code:"SNAPSHOT_EXPIRED"},409);
  if (error instanceof SyntaxError) return context.json({error:"JSON 格式无效。",code:"INVALID_JSON",requestId},400);
  console.error(JSON.stringify({requestId,path:context.req.path,message:String(error).slice(0,500)}));
  return context.json({error:"服务暂时不可用，请稍后重试。",code:"INTERNAL_ERROR",requestId},500);
});
registerPublishing(app);
registerMaintenance(app);
const cacheable=new Set(["/api/market-overview","/api/recommendations/top10","/api/market-heatmap","/api/market-indices"]);
app.use("/api/*",async(context,next)=>{
  if(context.req.method!=="GET" || !cacheable.has(context.req.path) || typeof caches==="undefined") return next();
  const cache=await caches.open("public-market-v2");
  const key=new Request(context.req.url,{method:"GET"});
  const hit=await cache.match(key);
  if(hit) return hit;
  await next();
  if(context.res.status===200) {
    context.header("Cache-Control","public,max-age=15");
    try { await cache.put(key,context.res.clone()); }
    catch { console.warn("Public market cache write failed"); }
  }
});
app.get("/api/ready",async(context)=>{
  const run=await context.env.DB.prepare("SELECT run_id,data_date FROM dataset_active WHERE dataset='screener'").first();
  return context.json({status:run ? "ready" : "unavailable",snapshot:run},run ? 200 : 503);
});


app.get("/api/health", (context) => context.json({ status: "ok" }));

app.get("/api/screener", async (context) => {
  const parsed = screenerQuerySchema.safeParse(Object.fromEntries(new URL(context.req.url).searchParams));
  if (!parsed.success) {
    return context.json({ error: "筛选条件无效。", details: parsed.error.flatten() }, 400);
  }
  const query = parsed.data;
  const identitySearch = Boolean(query.code || query.name);
  const version=await snapshotQuery(context.env.DB,identitySearch ? undefined : query.snapshotId);
  const conditions: string[] = [];
  const bindings: (string | number)[] = [];
  if (query.code) {
    conditions.push("s.code LIKE ?");
    bindings.push(query.code.length === 6 ? query.code : `%${query.code}%`);
  }
  if (query.name) {
    conditions.push(
      "LOWER(REPLACE(REPLACE(REPLACE(s.name, ' ', ''), '　', ''), char(9), '')) LIKE ?",
    );
    bindings.push(`%${normalizeSearchTerm(query.name)}%`);
  }
  if (!identitySearch && query.instrumentType) {
    conditions.push("s.instrument_type = ?");
    bindings.push(query.instrumentType);
  }
  if (!identitySearch) {
    conditions.push("s.is_st = 0");
  }
  if (!identitySearch && query.market) {
    conditions.push("d.market = ?");
    bindings.push(query.market);
  }
  if (!identitySearch && query.industry) {
    conditions.push("COALESCE(i.industry, d.industry) LIKE ?");
    bindings.push(`%${query.industry}%`);
  }
  if (!identitySearch) addRange(conditions, bindings, "s.close", query.minPrice, query.maxPrice);
  if (!identitySearch) addRange(conditions, bindings, "d.ret_20d", query.minRet20, query.maxRet20);
  if (!identitySearch && query.minTurnover !== undefined) {
    conditions.push("d.turnover_rate >= ?");
    bindings.push(query.minTurnover);
  }
  if (!identitySearch && query.maxVolatility !== undefined) {
    conditions.push("d.volatility_20 <= ?");
    bindings.push(query.maxVolatility);
  }
  if (!identitySearch && query.minScore !== undefined) {
    conditions.push("s.score_total >= ?");
    bindings.push(query.minScore);
  }
  // Browsing is tied to the latest completed full-market snapshot. Identity
  // searches deliberately bypass the snapshot boundary so supplemental ST
  // updates remain searchable without replacing the market heatmap/Top 10.
  if (!identitySearch && !version.snapshotId) {
    conditions.unshift(
      `s.updated_at = (${latestFullRunSql})`,
    );
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const orderColumn = {
    score: "s.score_total",
    price: "s.close",
    ret20: "d.ret_20d",
    turnover: "d.turnover_rate",
    volatility: "d.volatility_20",
  }[query.sortBy];
  const orderDirection = query.sortDirection === "asc" ? "ASC" : "DESC";
  const offset = (query.page - 1) * query.pageSize;
  const baseSql = `FROM ${identitySearch ? "stock_search_current" : "stock_current"} s
     LEFT JOIN ${identitySearch ? "stock_screen_search_current" : "stock_screen_current"} d ON d.code = s.code
     LEFT JOIN stock_industry_current i ON i.code = s.code
     ${where}`;
  const [rows, count, asOf] = await Promise.all([
    context.env.DB.prepare(
      `${version.sql}SELECT s.code, s.name, s.instrument_type, s.is_st, s.trade_date, s.quote_date, s.quote_time, s.quote_source,
              s.close, s.score_total, s.data_completeness, d.score_trend, d.score_momentum, d.score_volume_price, d.score_risk,
              d.market, COALESCE(i.industry, d.industry) AS industry, COALESCE(s.quote_pct_change, d.pct_change) AS pct_change, d.turnover_rate, d.ret_5d, d.ret_20d,
              d.ret_60d, d.ma20_slope, d.volume_ratio_20, d.volatility_20
         ${baseSql}
        ORDER BY ${orderColumn} ${orderDirection}, s.code ASC
        LIMIT ? OFFSET ?`,
    ).bind(...version.bindings,...bindings, query.pageSize, offset).all<ScreenerRow>(),
    context.env.DB.prepare(`${version.sql}SELECT COUNT(*) AS total ${baseSql}`).bind(...version.bindings,...bindings).first<{ total: number }>(),
    context.env.DB.prepare(
      `${version.sql}SELECT MAX(COALESCE(s.quote_date, s.trade_date)) AS trade_date
         FROM stock_current s
        WHERE ${version.snapshotId ? "1=1" : `s.updated_at = (${latestFullRunSql})`}`,
    ).bind(...version.bindings).first<{ trade_date: string | null }>(),
  ]);
  return context.json({
    snapshotId:version.snapshotId,
    items: rows.results.map(toScreenerItem),
    total: count?.total ?? 0,
    page: query.page,
    pageSize: query.pageSize,
    asOf: asOf?.trade_date ?? null,
  });
});

app.get("/api/market-overview", async (context) => {
  const overview = await context.env.DB.prepare(
    `SELECT COUNT(*) AS total_count,
            SUM(CASE WHEN d.ret_20d > 0 THEN 1 ELSE 0 END) AS up_count,
            SUM(CASE WHEN d.ret_20d < 0 THEN 1 ELSE 0 END) AS down_count,
            SUM(CASE WHEN d.ret_20d = 0 THEN 1 ELSE 0 END) AS flat_count,
            SUM(CASE WHEN d.ret_20d IS NOT NULL THEN 1 ELSE 0 END) AS ret20_available_count,
            AVG(d.ret_20d) AS average_ret20,
            AVG(s.score_total) AS average_score,
            SUM(CASE WHEN s.score_total >= 70 THEN 1 ELSE 0 END) AS high_score_count,
            MAX(COALESCE(s.quote_date, s.trade_date)) AS as_of
       FROM stock_current s
       LEFT JOIN stock_screen_current d ON d.code = s.code
      WHERE s.is_st = 0 AND s.updated_at = (${latestFullRunSql})`,
  ).first<MarketOverviewRow>();
  return context.json({
    totalCount: overview?.total_count ?? 0,
    upCount: overview?.up_count ?? 0,
    downCount: overview?.down_count ?? 0,
    flatCount: overview?.flat_count ?? 0,
    ret20AvailableCount: overview?.ret20_available_count ?? 0,
    averageRet20: overview?.average_ret20 ?? null,
    averageScore: overview?.average_score ?? null,
    highScoreCount: overview?.high_score_count ?? 0,
    asOf: overview?.as_of ?? null,
  });
});

const ruleConditionSchema = z.object({
  field: z.enum(["ret5d", "ret20d", "ret60d", "ret120d", "ret250d", "ma20Slope", "volumeRatio5", "volumeRatio20", "amount", "amountRatio5", "amountRatio20", "rsi14", "volatility20", "volatility60", "maxDrawdown60", "distanceHigh20", "distanceHigh60", "distanceHigh250", "distanceLow250", "pricePercentile250", "turnoverRate", "close", "score", "mainNetInflow", "mainNetInflowPct", "superLargeNetInflow", "largeNetInflow", "mediumNetInflow", "smallNetInflow", "mainNetInflow3d", "mainNetInflow5d", "mainNetInflow10d", "peTtm", "pb", "totalMarketCap", "floatMarketCap", "roe", "revenueYoy", "profitYoy", "grossMargin", "debtRatio", "revenue", "netProfit", "industry", "market"]),
  op: z.enum([">", ">=", "<", "<=", "==", "!=", "contains"]),
  value: z.union([z.number().finite(), z.string().trim().min(1).max(80)]),
});
const ruleScreenerSchema = z.object({
  logic: z.enum(["AND", "OR"]).default("AND"),
  conditions: z.array(ruleConditionSchema).min(1).max(20),
  excludeSt: z.boolean().default(true),
  sortBy: z.enum(["score", "price", "ret20", "turnover", "volatility"]).default("score"),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
  snapshotId: z.string().regex(/^[A-Za-z0-9._-]{8,100}$/).optional(),
  page: z.number().int().min(1).max(10000).default(1),
  pageSize: z.number().int().min(10).max(100).default(50),
});
const savedStrategySchema = z.object({
  name: z.string().trim().min(1).max(60),
  rule: ruleScreenerSchema,
});

type RuleDataCapability = "industry" | "moneyFlow" | "valuation" | "financial";

const ruleFieldCapabilities: Record<string, RuleDataCapability> = {
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

async function getRuleDataCapabilities(database: D1Database): Promise<Record<RuleDataCapability, boolean>> {
  const rows = await database.prepare(`SELECT
    (SELECT COUNT(*) FROM stock_industry_current WHERE industry <> '') AS industry,
    (SELECT COUNT(*) FROM stock_money_flow_current WHERE main_net_inflow IS NOT NULL AND data_date >= date('now','-14 days')) AS money_flow,
    (SELECT COUNT(*) FROM stock_valuation_current WHERE (pe_ttm IS NOT NULL OR pb IS NOT NULL) AND data_date >= date('now','-14 days')) AS valuation,
    (SELECT COUNT(*) FROM stock_financial_current WHERE (roe IS NOT NULL OR net_profit IS NOT NULL) AND report_date >= date('now','-18 months')) AS financial,
    (SELECT COUNT(*) FROM stock_current WHERE instrument_type='stock') AS expected
  `).first<{industry:number;money_flow:number;valuation:number;financial:number;expected:number}>();
  const minimum=Math.max(1,(rows?.expected ?? 0)*0.8);
  return {industry:(rows?.industry ?? 0)>=minimum,moneyFlow:(rows?.money_flow ?? 0)>=minimum,
    valuation:(rows?.valuation ?? 0)>=minimum,financial:(rows?.financial ?? 0)>=minimum};
}

app.get("/api/rule-data-capabilities", async (context) => context.json(await getRuleDataCapabilities(context.env.DB)));

app.get("/api/market-heatmap", async (context) => {
  const rows = await context.env.DB.prepare(
    `SELECT industry, data_date, inflow_amount, outflow_amount, net_inflow,
            company_count, pct_change, updated_at
       FROM industry_fund_flow_current
      WHERE inflow_amount + outflow_amount > 0
      ORDER BY inflow_amount + outflow_amount DESC, industry ASC`,
  ).all<SectorHeatmapRow>();
  const items = rows.results.map(toSectorHeatmapItem);
  return context.json({
    items,
    asOf: items.at(0)?.dataDate ?? null,
    updatedAt: items.map((item) => item.updatedAt).sort().at(-1) ?? null,
    moneyFlowAvailable: items.length > 0,
  });
});

app.get("/api/recommendations/top10", async (context) => {
  const rows = await context.env.DB.prepare(
    `SELECT s.code, s.name, s.instrument_type, s.is_st, s.trade_date, s.quote_date, s.quote_time, s.quote_source,
            s.close, s.score_total, s.data_completeness, d.score_trend, d.score_momentum, d.score_volume_price, d.score_risk,
            d.market, COALESCE(i.industry, d.industry) AS industry, COALESCE(s.quote_pct_change, d.pct_change) AS pct_change, d.turnover_rate, d.ret_5d, d.ret_20d,
            d.ret_60d, d.ma20_slope, d.volume_ratio_20, d.volatility_20
       FROM stock_current s
       LEFT JOIN stock_screen_current d ON d.code = s.code
       LEFT JOIN stock_industry_current i ON i.code = s.code
      WHERE s.is_st = 0 AND s.updated_at = (${latestFullRunSql})
      ORDER BY s.score_total DESC, s.code ASC
      LIMIT 10`,
  ).all<ScreenerRow>();
  return context.json({ items: rows.results.map(toScreenerItem) });
});

app.post("/api/rule-screener", async (context) => {
  const parsed = ruleScreenerSchema.safeParse(await context.req.json());
  if (!parsed.success) {
    return context.json({ error: "选股规则格式无效。", details: parsed.error.flatten() }, 400);
  }
  const query = parsed.data;
  const version=await snapshotQuery(context.env.DB,query.snapshotId);
  const requestedCapabilities = [...new Set(query.conditions.map((condition) => ruleFieldCapabilities[condition.field]).filter(Boolean))];
  if (requestedCapabilities.length) {
    const capabilities = await getRuleDataCapabilities(context.env.DB);
    const missing = requestedCapabilities.filter((capability) => !capabilities[capability]);
    if (missing.length) return context.json({ error: `数据尚未就绪或已过期：${missing.join("、")}`, code: "DATA_UNAVAILABLE", missing }, 409);
  }
  const fields = {
    ret5d: { sql: "d.ret_5d", numeric: true }, ret20d: { sql: "d.ret_20d", numeric: true },
    ret60d: { sql: "d.ret_60d", numeric: true }, ret120d: { sql: "d.ret_120d", numeric: true }, ret250d: { sql: "d.ret_250d", numeric: true }, ma20Slope: { sql: "d.ma20_slope", numeric: true },
    volumeRatio5: { sql: "d.volume_ratio_5", numeric: true }, volumeRatio20: { sql: "d.volume_ratio_20", numeric: true }, amount: { sql: "d.amount", numeric: true }, amountRatio5: { sql: "d.amount_ratio_5", numeric: true }, amountRatio20: { sql: "d.amount_ratio_20", numeric: true }, rsi14: { sql: "d.rsi_14", numeric: true }, volatility20: { sql: "d.volatility_20", numeric: true }, volatility60: { sql: "d.volatility_60", numeric: true }, maxDrawdown60: { sql: "d.max_drawdown_60", numeric: true }, distanceHigh20: { sql: "d.distance_high_20", numeric: true }, distanceHigh60: { sql: "d.distance_high_60", numeric: true }, distanceHigh250: { sql: "d.distance_high_250", numeric: true }, distanceLow250: { sql: "d.distance_low_250", numeric: true }, pricePercentile250: { sql: "d.price_percentile_250", numeric: true },
    mainNetInflow: { sql: "f.main_net_inflow", numeric: true }, mainNetInflowPct: { sql: "f.main_net_inflow_pct", numeric: true }, superLargeNetInflow: { sql: "f.super_large_net_inflow", numeric: true }, largeNetInflow: { sql: "f.large_net_inflow", numeric: true }, mediumNetInflow: { sql: "f.medium_net_inflow", numeric: true }, smallNetInflow: { sql: "f.small_net_inflow", numeric: true }, mainNetInflow3d: { sql: "f.main_net_inflow_3d", numeric: true }, mainNetInflow5d: { sql: "f.main_net_inflow_5d", numeric: true }, mainNetInflow10d: { sql: "f.main_net_inflow_10d", numeric: true },
    peTtm: { sql: "v.pe_ttm", numeric: true }, pb: { sql: "v.pb", numeric: true }, totalMarketCap: { sql: "v.total_market_cap", numeric: true }, floatMarketCap: { sql: "v.float_market_cap", numeric: true },
    roe: { sql: "n.roe", numeric: true }, revenueYoy: { sql: "n.revenue_yoy", numeric: true }, profitYoy: { sql: "n.profit_yoy", numeric: true }, grossMargin: { sql: "n.gross_margin", numeric: true }, debtRatio: { sql: "n.debt_ratio", numeric: true }, revenue: { sql: "n.revenue", numeric: true }, netProfit: { sql: "n.net_profit", numeric: true },
    turnoverRate: { sql: "d.turnover_rate", numeric: true }, close: { sql: "s.close", numeric: true },
    score: { sql: "s.score_total", numeric: true }, industry: { sql: "COALESCE(i.industry, d.industry)", numeric: false },
    market: { sql: "d.market", numeric: false },
  } as const;
  const conditions = [version.snapshotId ? "1=1" : `s.updated_at = (${latestFullRunSql})`];
  const bindings: (string | number)[] = [];
  if (query.excludeSt) conditions.push("s.is_st = 0");
  for (const condition of query.conditions) {
    const field = fields[condition.field];
    if (field.numeric) {
      if (typeof condition.value !== "number" || condition.op === "contains") {
        return context.json({ error: `${condition.field} 只支持数值比较。` }, 400);
      }
      conditions.push(`${field.sql} ${condition.op} ?`);
      bindings.push(condition.value);
    } else {
      if (typeof condition.value !== "string" || !["==", "!=", "contains"].includes(condition.op)) {
        return context.json({ error: `${condition.field} 只支持文本匹配。` }, 400);
      }
      conditions.push(`${field.sql} ${condition.op === "contains" ? "LIKE" : condition.op === "==" ? "=" : "!="} ?`);
      bindings.push(condition.op === "contains" ? `%${condition.value}%` : condition.value);
    }
  }
  const where = `WHERE ${query.logic === "AND" ? conditions.join(" AND ") : `(${conditions.slice(0, query.excludeSt ? 2 : 1).join(" AND ")}) AND (${conditions.slice(query.excludeSt ? 2 : 1).join(" OR ")})`}`;
  const orderColumn = { score: "s.score_total", price: "s.close", ret20: "d.ret_20d", turnover: "d.turnover_rate", volatility: "d.volatility_20" }[query.sortBy];
  const offset = (query.page - 1) * query.pageSize;
  const joins = ["LEFT JOIN stock_industry_current i ON i.code=s.code"];
  if (requestedCapabilities.includes("moneyFlow")) joins.push("LEFT JOIN stock_money_flow_current f ON f.code=s.code");
  if (requestedCapabilities.includes("valuation")) joins.push("LEFT JOIN stock_valuation_current v ON v.code=s.code");
  if (requestedCapabilities.includes("financial")) joins.push("LEFT JOIN stock_financial_current n ON n.code=s.code");
  const baseSql = `FROM stock_current s LEFT JOIN stock_screen_current d ON d.code=s.code ${joins.join(" ")} ${where}`;
  const [rows, count] = await Promise.all([
    context.env.DB.prepare(
      `${version.sql}SELECT s.code, s.name, s.instrument_type, s.is_st, s.trade_date, s.quote_date, s.quote_time, s.quote_source,
              s.close, s.score_total, s.data_completeness, d.score_trend, d.score_momentum, d.score_volume_price, d.score_risk, d.market, COALESCE(i.industry, d.industry) AS industry, COALESCE(s.quote_pct_change, d.pct_change) AS pct_change, d.turnover_rate,
              d.ret_5d, d.ret_20d, d.ret_60d, d.ma20_slope, d.volume_ratio_20, d.volatility_20 ${baseSql}
       ORDER BY ${orderColumn} ${query.sortDirection === "asc" ? "ASC" : "DESC"}, s.code ASC LIMIT ? OFFSET ?`,
    ).bind(...version.bindings,...bindings, query.pageSize, offset).all<ScreenerRow>(),
    context.env.DB.prepare(`${version.sql}SELECT COUNT(*) AS total ${baseSql}`).bind(...version.bindings,...bindings).first<{ total: number}>(),
  ]);
  return context.json({ snapshotId:version.snapshotId,items: rows.results.map(toScreenerItem), total: count?.total ?? 0, page: query.page, pageSize: query.pageSize });
});

app.get("/api/market-indices", async (context) => {
  const rows = await context.env.DB.prepare(
    `SELECT code, name, trade_date, quote_date, quote_time, quote_source, close, pct_change,
            ret_20d, ma20_slope, volatility_20
       FROM market_index_current
      ORDER BY code ASC`,
  ).all<MarketIndexRow>();
  return context.json({ items: rows.results.map(toMarketIndexItem) });
});

app.get("/api/data-refresh", async (context) => {
  await context.env.DB.prepare("UPDATE data_refresh_runs SET status='failed',completed_at=?,error_message='Refresh expired' WHERE status IN ('queued','running') AND requested_at < ?")
    .bind(new Date().toISOString(),new Date(Date.now()-60*60*1000).toISOString()).run();
  const latest = await context.env.DB.prepare(
    `SELECT id, status, requested_by, requested_at, started_at, completed_at, trade_date, row_count, error_message
       FROM data_refresh_runs ORDER BY requested_at DESC LIMIT 1`,
  ).first<DataRefreshRow>();
  return context.json({ refresh: latest ? toDataRefresh(latest) : null });
});

app.post("/api/data-refresh", async (context) => {
  const user = await requireUser(context);
  if (user instanceof Response) return user;
  if (!isAdmin(user, context.env)) return context.json({ error: "Administrator access is required." }, 403);
  if (!context.env.GITHUB_ACTIONS_TOKEN) return context.json({ error: "Cloud update is not configured." }, 503);

  await context.env.DB.prepare("UPDATE data_refresh_runs SET status='failed',completed_at=?,error_message='Refresh expired' WHERE status IN ('queued','running') AND requested_at < ?")
    .bind(new Date().toISOString(), new Date(Date.now()-60*60*1000).toISOString()).run();
  const active = await context.env.DB.prepare(
    "SELECT id FROM data_refresh_runs WHERE status IN ('queued', 'running') ORDER BY requested_at DESC LIMIT 1",
  ).first<{ id: string }>();
  if (active) return context.json({ error: "An update is already running.", id: active.id }, 409);

  const id = crypto.randomUUID();
  const requestedAt = new Date().toISOString();
  try { await context.env.DB.prepare(
    "INSERT INTO data_refresh_runs (id, status, requested_by, requested_at) VALUES (?, 'queued', ?, ?)",
  ).bind(id, user.username, requestedAt).run(); }
  catch (error) {
    if (String(error).includes("UNIQUE")) return context.json({error:"已有更新任务正在执行。"},409);
    throw error;
  }
  let response: Response;
  try { response = await fetch(
    `https://api.github.com/repos/${context.env.GITHUB_OWNER}/${context.env.GITHUB_REPOSITORY}/actions/workflows/${context.env.GITHUB_WORKFLOW}/dispatches`,
    { method: "POST", headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${context.env.GITHUB_ACTIONS_TOKEN}`, "User-Agent": "a-share-quant-app" }, body: JSON.stringify({ ref: "main", inputs: { refresh_id: id } }), signal: AbortSignal.timeout(15000) },
  ); } catch {
    await context.env.DB.prepare("UPDATE data_refresh_runs SET status='failed',completed_at=?,error_message='GitHub dispatch network failure' WHERE id=?")
      .bind(new Date().toISOString(),id).run();
    return context.json({error:"无法连接更新服务，请稍后重试。"},502);
  }
  if (!response.ok) {
    await context.env.DB.prepare("UPDATE data_refresh_runs SET status = 'failed', completed_at = ?, error_message = ? WHERE id = ?")
      .bind(new Date().toISOString(), `GitHub dispatch failed (${response.status}).`, id).run();
    return context.json({ error: "Could not start the cloud update." }, 502);
  }
  return context.json({ refresh: { id, status: "queued", requestedBy: user.username, requestedAt } }, 202);
});

app.post("/api/internal/data-refresh-callback", async (context) => {
  if (!context.env.REFRESH_CALLBACK_SECRET || !secretsEqual(context.req.header("X-Refresh-Secret") ?? "", context.env.REFRESH_CALLBACK_SECRET)) return context.json({ error: "Invalid callback credentials." }, 401);
  const body = refreshCallbackSchema.safeParse(await context.req.json());
  if (!body.success) return context.json({ error: "Invalid refresh callback." }, 400);
  const now = new Date().toISOString();
  const { id, status, tradeDate, rowCount, error } = body.data;
  const result = await context.env.DB.prepare(
    `UPDATE data_refresh_runs SET status = ?, started_at = CASE WHEN ? = 'running' THEN ? ELSE started_at END,
     completed_at = CASE WHEN ? IN ('completed', 'failed') THEN ? ELSE completed_at END,
     trade_date = COALESCE(?, trade_date), row_count = COALESCE(?, row_count), error_message = ? WHERE id = ? AND status IN ('queued','running')`,
  ).bind(status, status, now, status, now, tradeDate ?? null, rowCount ?? null, error ?? null, id).run();
  const current = await context.env.DB.prepare("SELECT status FROM data_refresh_runs WHERE id=?").bind(id).first<{status:string}>();
  if(!current) return context.json({error:"Refresh task not found"},404);
  return context.json({ id, status:current.status, ignored:!result.meta.changes });
});

app.get("/api/data-status", async (context) => {
  const status = await context.env.DB.prepare(
    `SELECT
       (SELECT MAX(quote_updated_at) FROM stock_current) AS quote_updated_at,
       (SELECT MAX(updated_at) FROM industry_fund_flow_current) AS industry_fund_flow_updated_at,
       (SELECT MAX(updated_at) FROM stock_money_flow_current) AS stock_money_flow_updated_at,
       (SELECT MAX(updated_at) FROM stock_valuation_current) AS valuation_updated_at,
       (SELECT MAX(updated_at) FROM stock_financial_current) AS financial_updated_at,
       (SELECT MAX(completed_at) FROM sync_runs WHERE status = 'completed' AND run_kind = 'full_market') AS screener_updated_at,
       (SELECT MAX(trade_date) FROM stock_screen_current) AS screener_trade_date`,
  ).first<DataStatusRow>();
  const datasets=await context.env.DB.prepare(`SELECT a.dataset,a.run_id,a.data_date,r.expected_rows,r.completed_at,r.meta_json
    FROM dataset_active a JOIN dataset_runs r ON r.run_id=a.run_id`).all<{dataset:string;run_id:string;data_date:string;expected_rows:number;completed_at:string;meta_json:string}>();
  return context.json({
    datasets:datasets.results.map((r)=>({dataset:r.dataset,runId:r.run_id,dataDate:r.data_date,rowCount:r.expected_rows,completedAt:r.completed_at,quality:(JSON.parse(r.meta_json) as Record<string,unknown>).quality ?? null})),
    quoteUpdatedAt: status?.quote_updated_at ?? null,
    industryFundFlowUpdatedAt: status?.industry_fund_flow_updated_at ?? null,
    stockMoneyFlowUpdatedAt: status?.stock_money_flow_updated_at ?? null,
    valuationUpdatedAt: status?.valuation_updated_at ?? null,
    financialUpdatedAt: status?.financial_updated_at ?? null,
    screenerUpdatedAt: status?.screener_updated_at ?? null,
    screenerTradeDate: status?.screener_trade_date ?? null,
  });
});

app.get("/api/internal/market-universe", async (context) => {
  if (!context.env.PUBLISH_SECRET || !secretsEqual(context.req.header("X-Publish-Secret") ?? "", context.env.PUBLISH_SECRET)) {
    return context.json({ error: "Invalid publish credentials." }, 401);
  }
  const [instruments, indices] = await Promise.all([
    context.env.DB.prepare(
      "SELECT code, instrument_type FROM stock_current WHERE instrument_type IN ('stock', 'etf') ORDER BY code ASC",
    ).all<{ code: string; instrument_type: "stock" | "etf" }>(),
    context.env.DB.prepare("SELECT code FROM market_index_current ORDER BY code ASC").all<{ code: string }>(),
  ]);
  return context.json({
    targets: [
      ...instruments.results.map((row) => ({ code: row.code, instrumentType: row.instrument_type })),
      ...indices.results.map((row) => ({ code: row.code, instrumentType: "index" })),
    ],
  });
});






app.post("/api/auth/login", async (context) => {
  const limiter=context.env.AUTH_LIMITER;
  if(limiter && !(await limiter.limit({key:`login:${context.req.header("CF-Connecting-IP") ?? "local"}`})).success) {
    context.header("Retry-After","60");
    return context.json({error:"登录请求过于频繁，请稍后重试。",code:"RATE_LIMITED"},429);
  }
  const body = loginSchema.safeParse(await context.req.json());
  if (!body.success) {
    return context.json({ error: "用户名或密码格式无效。" }, 400);
  }
  try {
    const user = await verifyFixedCredentials(body.data.username, body.data.password, context.env);
    await upsertUser(user, context.env);
    const token = await createSession(user, context.env);
    setCookie(context, "aq_session", token, {
      httpOnly: true,
      path: "/",
      sameSite: "Lax",
      secure: new URL(context.req.url).protocol === "https:",
      maxAge: 60 * 60 * 24 * 7,
    });
    return context.json({ user: publicUser(user, context.env) });
  } catch (error) {
    return authError(context, error);
  }
});

app.post("/api/auth/logout", (context) => {
  setCookie(context, "aq_session", "", { httpOnly: true, path: "/", maxAge: 0 });
  return context.body(null, 204);
});

app.get("/api/me", async (context) => {
  const user = await requireUser(context);
  if (user instanceof Response) {
    return user;
  }
  return context.json({ user: publicUser(user, context.env) });
});



app.get("/api/saved-strategies", async (context) => {
  const page=Math.max(1,Math.min(10000,Math.floor(Number(context.req.query("page"))||1)));
  const limit=100;

  const user = await requireUser(context);
  if (user instanceof Response) return user;
  const rows = await context.env.DB.prepare(
    "SELECT id, name, rule_json, created_at, updated_at FROM saved_strategies WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100 OFFSET ?",
  ).bind(user.id,(page-1)*limit).all<{ id: string; name: string; rule_json: string; created_at: string; updated_at: string }>();
  return context.json({ items: rows.results.flatMap((row) => {
    try {
      return [{ id: row.id, name: row.name, rule: ruleScreenerSchema.parse(JSON.parse(row.rule_json)), createdAt: row.created_at, updatedAt: row.updated_at }];
    } catch {
      return [];
    }
  }) });
});

app.post("/api/saved-strategies", async (context) => {
  const user = await requireUser(context);
  if (user instanceof Response) return user;
  const body = savedStrategySchema.safeParse(await context.req.json());
  if (!body.success) return context.json({ error: "策略格式无效。" }, 400);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await context.env.DB.prepare(
    `INSERT INTO saved_strategies (id, user_id, name, rule_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, name) DO UPDATE SET rule_json = excluded.rule_json, updated_at = excluded.updated_at`,
  ).bind(id, user.id, body.data.name, JSON.stringify(body.data.rule), now, now).run();
  const saved = await context.env.DB.prepare(
    "SELECT id, name, rule_json, created_at, updated_at FROM saved_strategies WHERE user_id = ? AND name = ?",
  ).bind(user.id, body.data.name).first<{ id: string; name: string; rule_json: string; created_at: string; updated_at: string }>();
  if (!saved) return context.json({ error: "策略保存失败。" }, 500);
  return context.json({ item: { id: saved.id, name: saved.name, rule: ruleScreenerSchema.parse(JSON.parse(saved.rule_json)), createdAt: saved.created_at, updatedAt: saved.updated_at } }, 201);
});

app.delete("/api/saved-strategies/:id", async (context) => {
  const user = await requireUser(context);
  if (user instanceof Response) return user;
  await context.env.DB.prepare("DELETE FROM saved_strategies WHERE id = ? AND user_id = ?")
    .bind(context.req.param("id"), user.id).run();
  return context.body(null, 204);
});

app.get("/api/watchlist", async (context) => {
  const page=Math.max(1,Math.min(10000,Math.floor(Number(context.req.query("page"))||1)));
  const limit=100;

  const user = await requireUser(context);
  if (user instanceof Response) {
    return user;
  }
  const rows = await context.env.DB.prepare(
    `SELECT w.code, w.source, w.added_at, w.observation_trade_date, w.observation_close,
            s.name, COALESCE(s.quote_date,s.trade_date) AS trade_date, s.close, s.score_total
       FROM watchlist_items w
       JOIN stock_search_current s ON s.code = w.code
      WHERE w.user_id = ?
      ORDER BY w.added_at DESC LIMIT 100 OFFSET ?`,
  )
    .bind(user.id,(page-1)*limit)
    .all<LatestStock & { source: string; added_at: string; observation_trade_date: string; observation_close: number }>();
  return context.json({
    items: rows.results.map((row) => ({
      code: row.code,
      name: row.name,
      source: row.source,
      addedAt: row.added_at,
      observationTradeDate: row.observation_trade_date,
      observationClose: row.observation_close,
      latestTradeDate: row.trade_date,
      latestClose: row.close,
      scoreTotal: row.score_total,
      tracking: calculateObservationTracking({
        observationClose: row.observation_close,
        latestClose: row.close,
      }),
    })),
  });
});

app.post("/api/watchlist", async (context) => {
  const user = await requireUser(context);
  if (user instanceof Response) {
    return user;
  }
  const body = addWatchlistSchema.safeParse(await context.req.json());
  if (!body.success) {
    return context.json({ error: "Stock code must be six digits." }, 400);
  }
  const latest = await context.env.DB.prepare(
    "SELECT code, name, COALESCE(quote_date,trade_date) AS trade_date, close, score_total FROM stock_search_current WHERE code = ?",
  )
    .bind(body.data.code)
    .first<LatestStock>();
  if (!latest || latest.close === null) {
    return context.json({ error: "No complete latest price is available for this stock." }, 409);
  }
  await context.env.DB.prepare(
    `INSERT INTO watchlist_items (
       id, user_id, code, source, added_at, observation_trade_date, observation_close
     ) VALUES (?, ?, ?, 'manual', ?, ?, ?)
     ON CONFLICT(user_id, code) DO NOTHING`,
  )
    .bind(crypto.randomUUID(), user.id, latest.code, new Date().toISOString(), latest.trade_date, latest.close)
    .run();
  return context.json({ item: latest }, 201);
});

app.delete("/api/watchlist/:code", async (context) => {
  const user = await requireUser(context);
  if (user instanceof Response) {
    return user;
  }
  await context.env.DB.prepare("DELETE FROM watchlist_items WHERE user_id = ? AND code = ?")
    .bind(user.id, context.req.param("code"))
    .run();
  return context.body(null, 204);
});

app.get("/api/recommendations/tracking", async (context) => {
  const user = await requireUser(context);
  if (user instanceof Response) {
    return user;
  }
  const rows = await context.env.DB.prepare(
    `SELECT r.trade_date, r.reference_trade_date, r.reference_close, r.code, r.rank, r.score, r.reasons_json, r.config_version,
            s.name, s.close, COALESCE(s.quote_date,s.trade_date) AS latest_trade_date
       FROM recommendation_snapshots r
       JOIN stock_current s ON s.code = r.code
      WHERE r.trade_date = (SELECT MAX(trade_date) FROM recommendation_snapshots)
      ORDER BY r.rank ASC
      LIMIT 20`,
  ).all<{
    trade_date: string;
    reference_trade_date: string;
    reference_close: number;
    code: string;
    rank: number;
    score: number;
    reasons_json: string;
    config_version: string;
    name: string;
    close: number | null;
    latest_trade_date: string;
  }>();
  return context.json({
    items: rows.results.map((row) => ({
      tradeDate: row.trade_date,
      referenceTradeDate: row.reference_trade_date,
      referenceClose: row.reference_close,
      code: row.code,
      name: row.name,
      rank: row.rank,
      score: row.score,
      configVersion: row.config_version,
      reasons: JSON.parse(row.reasons_json) as unknown,
      latestTradeDate: row.latest_trade_date,
      latestClose: row.close,
      tracking: calculateObservationTracking({ observationClose: row.reference_close, latestClose: row.close }),
    })),
  });
});

async function upsertUser(user: SessionUser, env: Env): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (id, google_sub, email, display_name, picture_url, username, created_at, last_login_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?)
     ON CONFLICT(google_sub) DO UPDATE SET
       email = excluded.email,
       display_name = excluded.display_name,
       username = excluded.username,
       last_login_at = excluded.last_login_at`,
  )
    .bind(user.id, user.id, `${user.username}@local.invalid`, user.displayName, user.username, now, now)
    .run();
}

type AppContext = Context<{ Bindings: Env }>;

async function requireUser(context: AppContext): Promise<SessionUser | Response> {
  const token = getCookie(context, "aq_session");
  if (!token) {
    return context.json({ error: "Authentication required." }, 401);
  }
  try {
    return await verifySession(token, context.env);
  } catch {
    return context.json({ error: "Session expired." }, 401);
  }
}

function publicUser(user: SessionUser, env: Env) {
  return { username: user.username, displayName: user.displayName, isAdmin: isAdmin(user, env) };
}

function isAdmin(user: SessionUser, env: Env): boolean {
  return (env.ADMIN_USERNAMES ?? "").split(",").map((name) => name.trim()).includes(user.username);
}

function authError(context: AppContext, error: unknown) {
  if (error instanceof AuthError) {
    return context.json({ error: error.message }, 401);
  }
  return context.json({ error: "登录验证失败。" }, 401);
}

interface ScreenerRow {
  code: string;
  name: string;
  instrument_type: "stock" | "etf";
  is_st: number;
  trade_date: string;
  quote_date: string | null;
  quote_time: string | null;
  quote_source: "tencent" | "sina" | null;
  close: number | null;
  score_total: number | null;
  score_trend: number | null;
  score_momentum: number | null;
  score_volume_price: number | null;
  score_risk: number | null;
  data_completeness: number | null;
  total_market_cap: number | null;
  float_market_cap: number | null;
  market: string | null;
  industry: string | null;
  pct_change: number | null;
  turnover_rate: number | null;
  ret_5d: number | null;
  ret_20d: number | null;
  ret_60d: number | null;
  ma20_slope: number | null;
  volume_ratio_20: number | null;
  volatility_20: number | null;
}

interface SectorHeatmapRow {
  industry: string;
  data_date: string;
  inflow_amount: number;
  outflow_amount: number;
  net_inflow: number;
  company_count: number | null;
  pct_change: number | null;
  updated_at: string;
}

interface DataRefreshRow {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  requested_by: string | null;
  requested_at: string;
  started_at: string | null;
  completed_at: string | null;
  trade_date: string | null;
  row_count: number | null;
  error_message: string | null;
}

function toDataRefresh(row: DataRefreshRow) {
  return {
    id: row.id, status: row.status, requestedBy: row.requested_by, requestedAt: row.requested_at,
    startedAt: row.started_at, completedAt: row.completed_at, tradeDate: row.trade_date,
    rowCount: row.row_count, error: row.error_message,
  };
}

interface MarketIndexRow {
  code: string;
  name: string;
  trade_date: string;
  quote_date: string | null;
  quote_time: string | null;
  quote_source: "tencent" | "sina" | null;
  close: number | null;
  pct_change: number | null;
  ret_20d: number | null;
  ma20_slope: number | null;
  volatility_20: number | null;
}

function addRange(
  conditions: string[],
  bindings: (string | number)[],
  column: string,
  minimum: number | undefined,
  maximum: number | undefined,
) {
  if (minimum !== undefined) {
    conditions.push(`${column} >= ?`);
    bindings.push(minimum);
  }
  if (maximum !== undefined) {
    conditions.push(`${column} <= ?`);
    bindings.push(maximum);
  }
}

function toScreenerItem(row: ScreenerRow) {
  return {
    code: row.code,
    name: row.name,
    instrumentType: row.instrument_type,
    isSt: row.is_st === 1,
    tradeDate: row.trade_date,
    quoteDate: row.quote_date,
    quoteTime: row.quote_time,
    quoteSource: row.quote_source,
    close: row.close,
    score: row.score_total,
    scoreTrend: row.score_trend,
    scoreMomentum: row.score_momentum,
    scoreVolumePrice: row.score_volume_price,
    scoreRisk: row.score_risk,
    dataCompleteness: row.data_completeness,
    totalMarketCap: row.total_market_cap,
    floatMarketCap: row.float_market_cap,
    market: row.market,
    industry: row.industry,
    pctChange: row.pct_change,
    turnoverRate: row.turnover_rate,
    ret5d: row.ret_5d,
    ret20d: row.ret_20d,
    ret60d: row.ret_60d,
    ma20Slope: row.ma20_slope,
    volumeRatio20: row.volume_ratio_20,
    volatility20: row.volatility_20,
  };
}

interface DataStatusRow {
  quote_updated_at: string | null;
  industry_fund_flow_updated_at: string | null;
  stock_money_flow_updated_at: string | null;
  valuation_updated_at: string | null;
  financial_updated_at: string | null;
  screener_updated_at: string | null;
  screener_trade_date: string | null;
}

interface MarketOverviewRow {
  total_count: number;
  up_count: number | null;
  down_count: number | null;
  flat_count: number | null;
  ret20_available_count: number | null;
  average_ret20: number | null;
  average_score: number | null;
  high_score_count: number | null;
  as_of: string | null;
}

function toSectorHeatmapItem(row: SectorHeatmapRow) {
  return {
    industry: row.industry,
    dataDate: row.data_date,
    inflowAmount: row.inflow_amount,
    outflowAmount: row.outflow_amount,
    netInflow: row.net_inflow,
    companyCount: row.company_count,
    pctChange: row.pct_change,
    updatedAt: row.updated_at,
  };
}

function toMarketIndexItem(row: MarketIndexRow) {
  return {
    code: row.code,
    name: row.name,
    tradeDate: row.trade_date,
    quoteDate: row.quote_date,
    quoteTime: row.quote_time,
    quoteSource: row.quote_source,
    close: row.close,
    pctChange: row.pct_change,
    ret20d: row.ret_20d,
    ma20Slope: row.ma20_slope,
    volatility20: row.volatility_20,
  };
}

function secretsEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.byteLength ^ rightBytes.byteLength;
  const length = Math.max(leftBytes.byteLength, rightBytes.byteLength);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

export default app;
