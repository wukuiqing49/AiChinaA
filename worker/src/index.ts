import { getCookie, setCookie } from "hono/cookie";
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";

import { AuthError, createSession, verifyFixedCredentials, verifySession } from "./auth";
import { calculateObservationTracking } from "./tracking";
import type { Env, LatestStock, SessionUser } from "./types";

const app = new Hono<{ Bindings: Env }>();
const latestFullRunSql = "SELECT started_at FROM sync_runs WHERE status = 'completed' AND run_kind = 'full_market' ORDER BY completed_at DESC LIMIT 1";

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
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
  sortBy: z.enum(["score", "price", "ret20", "turnover", "volatility"]).default("score"),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
});
const screenerPublishSchema = z.object({
  runId: z.string().regex(/^[A-Za-z0-9._-]{8,80}$/),
  tradeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  runKind: z.enum(["full_market", "supplemental_st", "single_stock"]).default("full_market"),
  stocks: z.array(z.object({
    code: z.string().regex(/^\d{6}$/),
    name: z.string().min(1).max(80),
    instrumentType: z.enum(["stock", "etf"]),
    isSt: z.boolean(),
    tradeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    quoteDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    quoteTime: z.string().regex(/^\d{2}:\d{2}:\d{2}$/).nullable(),
    quoteSource: z.enum(["tencent", "sina"]).nullable(),
    close: z.number().positive().nullable(),
    scoreTotal: z.number().min(0).max(100).nullable(),
    dataCompleteness: z.number().min(0).max(1).nullable(),
    market: z.string().max(8).nullable(),
    industry: z.string().max(80).nullable(),
    pctChange: z.number().nullable(),
    turnoverRate: z.number().min(0).nullable(),
    ret5d: z.number().nullable(),
    ret20d: z.number().nullable(),
    ret60d: z.number().nullable(),
    ma20Slope: z.number().nullable(),
    volumeRatio20: z.number().min(0).nullable(),
    volatility20: z.number().min(0).nullable(),
    volumeRatio5: z.number().min(0).nullable().default(null),
    amount: z.number().min(0).nullable().default(null),
    amountRatio5: z.number().min(0).nullable().default(null),
    amountRatio20: z.number().min(0).nullable().default(null),
    rsi14: z.number().min(0).max(100).nullable().default(null),
    ret120d: z.number().nullable().default(null),
    ret250d: z.number().nullable().default(null),
    distanceHigh20: z.number().nullable().default(null),
    distanceHigh60: z.number().nullable().default(null),
    distanceHigh250: z.number().nullable().default(null),
    distanceLow250: z.number().nullable().default(null),
    pricePercentile250: z.number().min(0).max(1).nullable().default(null),
    volatility60: z.number().min(0).nullable().default(null),
    maxDrawdown60: z.number().nullable().default(null),
  })).min(1).max(6000),
  indices: z.array(z.object({
    code: z.string().min(6).max(12),
    name: z.string().min(1).max(80),
    tradeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    quoteDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    quoteTime: z.string().regex(/^\d{2}:\d{2}:\d{2}$/).nullable(),
    quoteSource: z.enum(["tencent", "sina"]).nullable(),
    close: z.number().positive().nullable(),
    pctChange: z.number().nullable(),
    ret20d: z.number().nullable(),
    ma20Slope: z.number().nullable(),
    volatility20: z.number().min(0).nullable(),
  })).max(100).default([]),
});
const realtimeQuotePublishSchema = z.object({
  generatedAt: z.string().max(64).optional(),
  quotes: z.array(z.object({
    code: z.string().min(6).max(12),
    instrumentType: z.enum(["stock", "etf", "index"]),
    name: z.string().trim().min(1).max(80).optional(),
    close: z.number().finite().positive(),
    pctChange: z.number().finite(),
    quoteDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    quoteTime: z.string().regex(/^\d{2}:\d{2}:\d{2}$/),
    quoteSource: z.enum(["tencent", "sina"]),
  })).min(1).max(6000),
});

app.get("/api/health", (context) => context.json({ status: "ok" }));

app.get("/api/screener", async (context) => {
  const parsed = screenerQuerySchema.safeParse(Object.fromEntries(new URL(context.req.url).searchParams));
  if (!parsed.success) {
    return context.json({ error: "筛选条件无效。", details: parsed.error.flatten() }, 400);
  }
  const query = parsed.data;
  const identitySearch = Boolean(query.code || query.name);
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
  if (!identitySearch) {
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
  const baseSql = `FROM stock_latest s
     LEFT JOIN stock_screen_latest d ON d.code = s.code
     LEFT JOIN stock_industry_latest i ON i.code = s.code
     ${where}`;
  const [rows, count, asOf] = await Promise.all([
    context.env.DB.prepare(
      `SELECT s.code, s.name, s.instrument_type, s.is_st, s.trade_date, s.quote_date, s.quote_time, s.quote_source,
              s.close, s.score_total, s.data_completeness,
              d.market, COALESCE(i.industry, d.industry) AS industry, COALESCE(s.quote_pct_change, d.pct_change) AS pct_change, d.turnover_rate, d.ret_5d, d.ret_20d,
              d.ret_60d, d.ma20_slope, d.volume_ratio_20, d.volatility_20
         ${baseSql}
        ORDER BY ${orderColumn} ${orderDirection}, s.code ASC
        LIMIT ? OFFSET ?`,
    ).bind(...bindings, query.pageSize, offset).all<ScreenerRow>(),
    context.env.DB.prepare(`SELECT COUNT(*) AS total ${baseSql}`).bind(...bindings).first<{ total: number }>(),
    context.env.DB.prepare(
      `SELECT MAX(COALESCE(s.quote_date, s.trade_date)) AS trade_date
         FROM stock_latest s
        WHERE s.updated_at = (
          ${latestFullRunSql}
        )`,
    ).first<{ trade_date: string | null }>(),
  ]);
  return context.json({
    items: rows.results.map(toScreenerItem),
    total: count?.total ?? 0,
    page: query.page,
    pageSize: query.pageSize,
    asOf: asOf?.trade_date ?? null,
  });
});
const moneyFlowPublishSchema = z.object({
  dataDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.string().min(1).max(80),
  rows: z.array(z.object({
    code: z.string().regex(/^\d{6}$/),
    mainNetInflow: z.number().nullable(), mainNetInflowPct: z.number().nullable(),
    superLargeNetInflow: z.number().nullable(), largeNetInflow: z.number().nullable(),
    mediumNetInflow: z.number().nullable(), smallNetInflow: z.number().nullable(),
    mainNetInflow3d: z.number().nullable(), mainNetInflow5d: z.number().nullable(), mainNetInflow10d: z.number().nullable(),
  })).min(1).max(6000),
});
const industryFundFlowPublishSchema = z.object({
  dataDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.string().min(1).max(80),
  persistHistory: z.boolean().default(false),
  rows: z.array(z.object({
    industry: z.string().trim().min(1).max(80),
    inflowAmount: z.number().finite().min(0),
    outflowAmount: z.number().finite().min(0),
    netInflow: z.number().finite(),
    companyCount: z.number().int().min(0).nullable(),
    pctChange: z.number().finite().nullable(),
  })).min(1).max(300),
});
const valuationPublishSchema = z.object({
  dataDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), source: z.string().min(1).max(80),
  rows: z.array(z.object({ code: z.string().regex(/^\d{6}$/), peTtm: z.number().nullable(), pb: z.number().nullable(), totalMarketCap: z.number().min(0).nullable(), floatMarketCap: z.number().min(0).nullable() })).min(1).max(6000),
});
const industryPublishSchema = z.object({
  source: z.string().min(1).max(80),
  rows: z.array(z.object({ code: z.string().regex(/^\d{6}$/), industry: z.string().trim().min(1).max(80) })).min(1).max(6000),
});
const financialPublishSchema = z.object({ dataDate: z.string(), reportDate: z.string(), source: z.string().min(1), rows: z.array(z.object({ code: z.string().regex(/^\d{6}$/), announcementDate: z.string().nullable().optional(), roe: z.number().nullable(), revenueYoy: z.number().nullable(), profitYoy: z.number().nullable(), grossMargin: z.number().nullable(), debtRatio: z.number().nullable(), revenue: z.number().nullable(), netProfit: z.number().nullable() })).min(1).max(6000) });
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
  const rows = await database.prepare(
    `SELECT
       EXISTS(SELECT 1 FROM stock_industry_latest LIMIT 1) AS industry,
       EXISTS(SELECT 1 FROM stock_money_flow_latest LIMIT 1) AS money_flow,
       EXISTS(SELECT 1 FROM stock_valuation_latest LIMIT 1) AS valuation,
       EXISTS(SELECT 1 FROM stock_financial_latest LIMIT 1) AS financial`,
  ).first<{ industry: number; money_flow: number; valuation: number; financial: number }>();
  return {
    industry: Boolean(rows?.industry),
    moneyFlow: Boolean(rows?.money_flow),
    valuation: Boolean(rows?.valuation),
    financial: Boolean(rows?.financial),
  };
}

app.get("/api/rule-data-capabilities", async (context) => context.json(await getRuleDataCapabilities(context.env.DB)));

app.get("/api/market-heatmap", async (context) => {
  const rows = await context.env.DB.prepare(
    `SELECT industry, data_date, inflow_amount, outflow_amount, net_inflow,
            company_count, pct_change, updated_at
       FROM industry_fund_flow_latest
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
            s.close, s.score_total, s.data_completeness,
            d.market, COALESCE(i.industry, d.industry) AS industry, COALESCE(s.quote_pct_change, d.pct_change) AS pct_change, d.turnover_rate, d.ret_5d, d.ret_20d,
            d.ret_60d, d.ma20_slope, d.volume_ratio_20, d.volatility_20
       FROM stock_latest s
       LEFT JOIN stock_screen_latest d ON d.code = s.code
       LEFT JOIN stock_industry_latest i ON i.code = s.code
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
  const requestedCapability = query.conditions
    .map((condition) => ruleFieldCapabilities[condition.field])
    .find((capability): capability is RuleDataCapability => capability !== undefined);
  if (requestedCapability) {
    const capabilities = await getRuleDataCapabilities(context.env.DB);
    if (!capabilities[requestedCapability]) {
      return context.json({ error: "所选字段的数据尚未就绪。" }, 409);
    }
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
  const conditions = [`s.updated_at = (${latestFullRunSql})`];
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
  const baseSql = `FROM stock_latest s LEFT JOIN stock_screen_latest d ON d.code = s.code LEFT JOIN stock_industry_latest i ON i.code = s.code LEFT JOIN stock_money_flow_latest f ON f.code = s.code LEFT JOIN stock_valuation_latest v ON v.code = s.code LEFT JOIN stock_financial_latest n ON n.code = s.code ${where}`;
  const [rows, count] = await Promise.all([
    context.env.DB.prepare(
      `SELECT s.code, s.name, s.instrument_type, s.is_st, s.trade_date, s.quote_date, s.quote_time, s.quote_source,
              s.close, s.score_total, s.data_completeness, d.market, COALESCE(i.industry, d.industry) AS industry, COALESCE(s.quote_pct_change, d.pct_change) AS pct_change, d.turnover_rate,
              d.ret_5d, d.ret_20d, d.ret_60d, d.ma20_slope, d.volume_ratio_20, d.volatility_20 ${baseSql}
       ORDER BY ${orderColumn} ${query.sortDirection === "asc" ? "ASC" : "DESC"}, s.code ASC LIMIT ? OFFSET ?`,
    ).bind(...bindings, query.pageSize, offset).all<ScreenerRow>(),
    context.env.DB.prepare(`SELECT COUNT(*) AS total ${baseSql}`).bind(...bindings).first<{ total: number}>(),
  ]);
  return context.json({ items: rows.results.map(toScreenerItem), total: count?.total ?? 0, page: query.page, pageSize: query.pageSize });
});

app.get("/api/market-indices", async (context) => {
  const rows = await context.env.DB.prepare(
    `SELECT code, name, trade_date, quote_date, quote_time, quote_source, close, pct_change,
            ret_20d, ma20_slope, volatility_20
       FROM market_index_latest
      ORDER BY code ASC`,
  ).all<MarketIndexRow>();
  return context.json({ items: rows.results.map(toMarketIndexItem) });
});

app.get("/api/data-refresh", async (context) => {
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

  const active = await context.env.DB.prepare(
    "SELECT id FROM data_refresh_runs WHERE status IN ('queued', 'running') ORDER BY requested_at DESC LIMIT 1",
  ).first<{ id: string }>();
  if (active) return context.json({ error: "An update is already running.", id: active.id }, 409);

  const id = crypto.randomUUID();
  const requestedAt = new Date().toISOString();
  await context.env.DB.prepare(
    "INSERT INTO data_refresh_runs (id, status, requested_by, requested_at) VALUES (?, 'queued', ?, ?)",
  ).bind(id, user.username, requestedAt).run();
  const response = await fetch(
    `https://api.github.com/repos/${context.env.GITHUB_OWNER}/${context.env.GITHUB_REPOSITORY}/actions/workflows/${context.env.GITHUB_WORKFLOW}/dispatches`,
    { method: "POST", headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${context.env.GITHUB_ACTIONS_TOKEN}`, "User-Agent": "a-share-quant-app" }, body: JSON.stringify({ ref: "main", inputs: { refresh_id: id } }) },
  );
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
  await context.env.DB.prepare(
    `UPDATE data_refresh_runs SET status = ?, started_at = CASE WHEN ? = 'running' THEN ? ELSE started_at END,
     completed_at = CASE WHEN ? IN ('completed', 'failed') THEN ? ELSE completed_at END,
     trade_date = COALESCE(?, trade_date), row_count = COALESCE(?, row_count), error_message = ? WHERE id = ?`,
  ).bind(status, status, now, status, now, tradeDate ?? null, rowCount ?? null, error ?? null, id).run();
  return context.json({ id, status });
});

app.get("/api/internal/market-universe", async (context) => {
  if (!context.env.PUBLISH_SECRET || !secretsEqual(context.req.header("X-Publish-Secret") ?? "", context.env.PUBLISH_SECRET)) {
    return context.json({ error: "Invalid publish credentials." }, 401);
  }
  const [instruments, indices] = await Promise.all([
    context.env.DB.prepare(
      "SELECT code, instrument_type FROM stock_latest WHERE instrument_type IN ('stock', 'etf') ORDER BY code ASC",
    ).all<{ code: string; instrument_type: "stock" | "etf" }>(),
    context.env.DB.prepare("SELECT code FROM market_index_latest ORDER BY code ASC").all<{ code: string }>(),
  ]);
  return context.json({
    targets: [
      ...instruments.results.map((row) => ({ code: row.code, instrumentType: row.instrument_type })),
      ...indices.results.map((row) => ({ code: row.code, instrumentType: "index" })),
    ],
  });
});

app.post("/api/internal/publish-screener", async (context) => {
  if (!context.env.PUBLISH_SECRET || !secretsEqual(context.req.header("X-Publish-Secret") ?? "", context.env.PUBLISH_SECRET)) {
    return context.json({ error: "发布凭据无效。" }, 401);
  }
  const body = screenerPublishSchema.safeParse(await context.req.json());
  if (!body.success) {
    return context.json({ error: "筛选发布包格式无效。", details: body.error.flatten() }, 400);
  }
  const { runId, tradeDate, runKind, stocks, indices } = body.data;
  const startedAt = new Date().toISOString();
  const existing = await context.env.DB.prepare("SELECT status, row_count FROM sync_runs WHERE run_id = ?").bind(runId).first<{ status: string; row_count: number }>();
  if (existing?.status === "completed") {
    return context.json({ runId, status: existing.status, rowCount: existing.row_count, idempotent: true });
  }
  await context.env.DB.prepare(
    `INSERT INTO sync_runs (run_id, trade_date, run_kind, status, row_count, started_at)
     VALUES (?, ?, ?, 'running', 0, ?)
     ON CONFLICT(run_id) DO UPDATE SET run_kind = excluded.run_kind, status = 'running', error_message = NULL, started_at = excluded.started_at`,
  ).bind(runId, tradeDate, runKind, startedAt).run();
  try {
    const statements = [
      ...stocks.flatMap((stock) => [
      context.env.DB.prepare(
        `INSERT INTO stock_latest (
           code, name, instrument_type, is_st, trade_date, quote_date, quote_time, quote_source, close,
           score_total, data_completeness, quote_pct_change, quote_updated_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET name = excluded.name, instrument_type = excluded.instrument_type, trade_date = excluded.trade_date,
           is_st = excluded.is_st, quote_date = excluded.quote_date, quote_time = excluded.quote_time, quote_source = excluded.quote_source,
           close = excluded.close, score_total = excluded.score_total,
           data_completeness = excluded.data_completeness, quote_pct_change = excluded.quote_pct_change,
           quote_updated_at = excluded.quote_updated_at, updated_at = excluded.updated_at`,
      ).bind(stock.code, stock.name, stock.instrumentType, stock.isSt ? 1 : 0, stock.tradeDate, stock.quoteDate, stock.quoteTime, stock.quoteSource, stock.close, stock.scoreTotal, stock.dataCompleteness, stock.pctChange, startedAt, startedAt),
      context.env.DB.prepare(
        `INSERT INTO stock_screen_latest (
           code, trade_date, market, industry, pct_change, turnover_rate, ret_5d, ret_20d,
           ret_60d, ma20_slope, volume_ratio_20, volatility_20, volume_ratio_5, amount,
           amount_ratio_5, amount_ratio_20, rsi_14, ret_120d, ret_250d, distance_high_20,
           distance_high_60, distance_high_250, distance_low_250, price_percentile_250,
           volatility_60, max_drawdown_60, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET trade_date = excluded.trade_date, market = excluded.market,
           industry = excluded.industry, pct_change = excluded.pct_change, turnover_rate = excluded.turnover_rate,
           ret_5d = excluded.ret_5d, ret_20d = excluded.ret_20d, ret_60d = excluded.ret_60d,
           ma20_slope = excluded.ma20_slope, volume_ratio_20 = excluded.volume_ratio_20,
           volatility_20 = excluded.volatility_20, volume_ratio_5 = excluded.volume_ratio_5,
           amount = excluded.amount, amount_ratio_5 = excluded.amount_ratio_5, amount_ratio_20 = excluded.amount_ratio_20,
           rsi_14 = excluded.rsi_14, ret_120d = excluded.ret_120d, ret_250d = excluded.ret_250d,
           distance_high_20 = excluded.distance_high_20, distance_high_60 = excluded.distance_high_60,
           distance_high_250 = excluded.distance_high_250, distance_low_250 = excluded.distance_low_250,
           price_percentile_250 = excluded.price_percentile_250, volatility_60 = excluded.volatility_60,
           max_drawdown_60 = excluded.max_drawdown_60, updated_at = excluded.updated_at`,
      ).bind(stock.code, stock.tradeDate, stock.market, stock.industry, stock.pctChange, stock.turnoverRate, stock.ret5d, stock.ret20d, stock.ret60d, stock.ma20Slope, stock.volumeRatio20, stock.volatility20, stock.volumeRatio5, stock.amount, stock.amountRatio5, stock.amountRatio20, stock.rsi14, stock.ret120d, stock.ret250d, stock.distanceHigh20, stock.distanceHigh60, stock.distanceHigh250, stock.distanceLow250, stock.pricePercentile250, stock.volatility60, stock.maxDrawdown60, startedAt),
      ]),
      ...indices.map((index) => context.env.DB.prepare(
        `INSERT INTO market_index_latest (
           code, name, trade_date, quote_date, quote_time, quote_source, close, pct_change,
           ret_20d, ma20_slope, volatility_20, quote_updated_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET name = excluded.name, trade_date = excluded.trade_date,
           quote_date = excluded.quote_date, quote_time = excluded.quote_time, quote_source = excluded.quote_source,
           close = excluded.close, pct_change = excluded.pct_change, ret_20d = excluded.ret_20d,
           ma20_slope = excluded.ma20_slope, volatility_20 = excluded.volatility_20, quote_updated_at = excluded.quote_updated_at, updated_at = excluded.updated_at`,
      ).bind(index.code, index.name, index.tradeDate, index.quoteDate, index.quoteTime, index.quoteSource, index.close, index.pctChange, index.ret20d, index.ma20Slope, index.volatility20, startedAt, startedAt)),
    ];
    for (let index = 0; index < statements.length; index += 100) {
      await context.env.DB.batch(statements.slice(index, index + 100));
    }
    await context.env.DB.prepare("UPDATE sync_runs SET status = 'completed', row_count = ?, completed_at = ? WHERE run_id = ?").bind(stocks.length, new Date().toISOString(), runId).run();
    return context.json({ runId, status: "completed", rowCount: stocks.length });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown publish error";
    await context.env.DB.prepare("UPDATE sync_runs SET status = 'failed', error_message = ?, completed_at = ? WHERE run_id = ?").bind(message, new Date().toISOString(), runId).run();
    return context.json({ error: "筛选数据发布失败。", runId }, 500);
  }
});

app.post("/api/internal/publish-fund-flow", async (context) => {
  if (!context.env.PUBLISH_SECRET || !secretsEqual(context.req.header("X-Publish-Secret") ?? "", context.env.PUBLISH_SECRET)) {
    return context.json({ error: "发布凭据无效。" }, 401);
  }
  const body = moneyFlowPublishSchema.safeParse(await context.req.json());
  if (!body.success) return context.json({ error: "资金流发布包格式无效。", details: body.error.flatten() }, 400);
  const { dataDate, source, rows } = body.data;
  const now = new Date().toISOString();
  const statements = rows.map((row) => context.env.DB.prepare(
    `INSERT INTO stock_money_flow_latest (
       code, data_date, source, main_net_inflow, main_net_inflow_pct, super_large_net_inflow,
       large_net_inflow, medium_net_inflow, small_net_inflow, main_net_inflow_3d,
       main_net_inflow_5d, main_net_inflow_10d, updated_at
     ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM stock_latest WHERE code = ?)
     ON CONFLICT(code) DO UPDATE SET data_date=excluded.data_date, source=excluded.source,
       main_net_inflow=excluded.main_net_inflow, main_net_inflow_pct=excluded.main_net_inflow_pct,
       super_large_net_inflow=excluded.super_large_net_inflow, large_net_inflow=excluded.large_net_inflow,
       medium_net_inflow=excluded.medium_net_inflow, small_net_inflow=excluded.small_net_inflow,
       main_net_inflow_3d=excluded.main_net_inflow_3d, main_net_inflow_5d=excluded.main_net_inflow_5d,
       main_net_inflow_10d=excluded.main_net_inflow_10d, updated_at=excluded.updated_at`,
  ).bind(row.code, dataDate, source, row.mainNetInflow, row.mainNetInflowPct, row.superLargeNetInflow, row.largeNetInflow, row.mediumNetInflow, row.smallNetInflow, row.mainNetInflow3d, row.mainNetInflow5d, row.mainNetInflow10d, now, row.code));
  const dailyStatements = rows.map((row) => context.env.DB.prepare(
    `INSERT INTO stock_money_flow_daily (code, data_date, source, main_net_inflow, main_net_inflow_pct, super_large_net_inflow, large_net_inflow, medium_net_inflow, small_net_inflow, main_net_inflow_3d, main_net_inflow_5d, main_net_inflow_10d, fetched_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM stock_latest WHERE code = ?)
     ON CONFLICT(code, data_date) DO UPDATE SET source=excluded.source, main_net_inflow=excluded.main_net_inflow, main_net_inflow_pct=excluded.main_net_inflow_pct, super_large_net_inflow=excluded.super_large_net_inflow, large_net_inflow=excluded.large_net_inflow, medium_net_inflow=excluded.medium_net_inflow, small_net_inflow=excluded.small_net_inflow, main_net_inflow_3d=excluded.main_net_inflow_3d, main_net_inflow_5d=excluded.main_net_inflow_5d, main_net_inflow_10d=excluded.main_net_inflow_10d, fetched_at=excluded.fetched_at`,
  ).bind(row.code, dataDate, source, row.mainNetInflow, row.mainNetInflowPct, row.superLargeNetInflow, row.largeNetInflow, row.mediumNetInflow, row.smallNetInflow, row.mainNetInflow3d, row.mainNetInflow5d, row.mainNetInflow10d, now, row.code));
  try {
    const allStatements = [...statements, ...dailyStatements];
    for (let index = 0; index < allStatements.length; index += 100) await context.env.DB.batch(allStatements.slice(index, index + 100));
    return context.json({ status: "completed", rowCount: rows.length, dataDate, source });
  } catch (error) {
    return context.json({ error: error instanceof Error ? error.message.slice(0, 500) : "资金流保存失败。" }, 500);
  }
});

app.post("/api/internal/publish-industry-map", async (context) => {
  if (!context.env.PUBLISH_SECRET || !secretsEqual(context.req.header("X-Publish-Secret") ?? "", context.env.PUBLISH_SECRET)) {
    return context.json({ error: "Invalid publish credentials." }, 401);
  }
  const body = industryPublishSchema.safeParse(await context.req.json());
  if (!body.success) return context.json({ error: "Invalid industry mapping payload.", details: body.error.flatten() }, 400);
  const now = new Date().toISOString();
  const statements = body.data.rows.map((row) => context.env.DB.prepare(
    `INSERT INTO stock_industry_latest (code, industry, source, updated_at)
     SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM stock_latest WHERE code = ?)
     ON CONFLICT(code) DO UPDATE SET industry = excluded.industry, source = excluded.source, updated_at = excluded.updated_at`,
  ).bind(row.code, row.industry, body.data.source, now, row.code));
  try {
    for (let index = 0; index < statements.length; index += 100) await context.env.DB.batch(statements.slice(index, index + 100));
    return context.json({ status: "completed", rowCount: body.data.rows.length, source: body.data.source });
  } catch (error) {
    return context.json({ error: error instanceof Error ? error.message.slice(0, 500) : "Could not save industry mapping." }, 500);
  }
});

app.post("/api/internal/publish-valuation", async (context) => {
  if (!context.env.PUBLISH_SECRET || !secretsEqual(context.req.header("X-Publish-Secret") ?? "", context.env.PUBLISH_SECRET)) return context.json({ error: "发布凭据无效。" }, 401);
  const body = valuationPublishSchema.safeParse(await context.req.json());
  if (!body.success) return context.json({ error: "估值发布包格式无效。", details: body.error.flatten() }, 400);
  const { dataDate, source, rows } = body.data;
  const now = new Date().toISOString();
  const statements = rows.map((row) => context.env.DB.prepare(
    `INSERT INTO stock_valuation_latest (code, data_date, source, pe_ttm, pb, total_market_cap, float_market_cap, updated_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM stock_latest WHERE code = ?)
     ON CONFLICT(code) DO UPDATE SET data_date=excluded.data_date, source=excluded.source, pe_ttm=excluded.pe_ttm, pb=excluded.pb, total_market_cap=excluded.total_market_cap, float_market_cap=excluded.float_market_cap, updated_at=excluded.updated_at`,
  ).bind(row.code, dataDate, source, row.peTtm, row.pb, row.totalMarketCap, row.floatMarketCap, now, row.code));
  const dailyStatements = rows.map((row) => context.env.DB.prepare(
    `INSERT INTO stock_valuation_daily (code, data_date, source, pe_ttm, pb, total_market_cap, float_market_cap, fetched_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM stock_latest WHERE code = ?)
     ON CONFLICT(code, data_date) DO UPDATE SET source=excluded.source, pe_ttm=excluded.pe_ttm, pb=excluded.pb, total_market_cap=excluded.total_market_cap, float_market_cap=excluded.float_market_cap, fetched_at=excluded.fetched_at`,
  ).bind(row.code, dataDate, source, row.peTtm, row.pb, row.totalMarketCap, row.floatMarketCap, now, row.code));
  try { const allStatements = [...statements, ...dailyStatements]; for (let index = 0; index < allStatements.length; index += 100) await context.env.DB.batch(allStatements.slice(index, index + 100)); return context.json({ status: "completed", rowCount: rows.length, dataDate, source }); }
  catch (error) { return context.json({ error: error instanceof Error ? error.message.slice(0, 500) : "估值保存失败。" }, 500); }
});

app.post("/api/internal/publish-financials", async (context) => {
  if (!context.env.PUBLISH_SECRET || !secretsEqual(context.req.header("X-Publish-Secret") ?? "", context.env.PUBLISH_SECRET)) return context.json({ error: "发布凭据无效。" }, 401);
  const body = financialPublishSchema.safeParse(await context.req.json());
  if (!body.success) return context.json({ error: "财务发布包格式无效。" }, 400);
  const { dataDate, reportDate, source, rows } = body.data, now = new Date().toISOString();
  const statements = rows.flatMap((r) => [
    context.env.DB.prepare(`INSERT INTO stock_financial_latest (code,report_date,announcement_date,source,roe,revenue_yoy,profit_yoy,gross_margin,debt_ratio,revenue,net_profit,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM stock_latest WHERE code=?) ON CONFLICT(code) DO UPDATE SET report_date=excluded.report_date,announcement_date=excluded.announcement_date,source=excluded.source,roe=excluded.roe,revenue_yoy=excluded.revenue_yoy,profit_yoy=excluded.profit_yoy,gross_margin=excluded.gross_margin,debt_ratio=excluded.debt_ratio,revenue=excluded.revenue,net_profit=excluded.net_profit,updated_at=excluded.updated_at`).bind(r.code,reportDate,r.announcementDate??null,source,r.roe,r.revenueYoy,r.profitYoy,r.grossMargin,r.debtRatio,r.revenue,r.netProfit,now,r.code),
    context.env.DB.prepare(`INSERT INTO stock_financial_daily (code,data_date,report_date,announcement_date,source,roe,revenue_yoy,profit_yoy,gross_margin,debt_ratio,revenue,net_profit,fetched_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM stock_latest WHERE code=?) ON CONFLICT(code,data_date,report_date) DO UPDATE SET announcement_date=excluded.announcement_date,source=excluded.source,roe=excluded.roe,revenue_yoy=excluded.revenue_yoy,profit_yoy=excluded.profit_yoy,gross_margin=excluded.gross_margin,debt_ratio=excluded.debt_ratio,revenue=excluded.revenue,net_profit=excluded.net_profit,fetched_at=excluded.fetched_at`).bind(r.code,dataDate,reportDate,r.announcementDate??null,source,r.roe,r.revenueYoy,r.profitYoy,r.grossMargin,r.debtRatio,r.revenue,r.netProfit,now,r.code),
  ]);
  try { for (let i=0;i<statements.length;i+=100) await context.env.DB.batch(statements.slice(i,i+100)); return context.json({status:"completed",rowCount:rows.length,reportDate}); } catch (error) { return context.json({error:error instanceof Error ? error.message.slice(0,500) : "财务保存失败。"},500); }
});

app.post("/api/auth/login", async (context) => {
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

app.post("/api/internal/publish-industry-fund-flow", async (context) => {
  if (!context.env.PUBLISH_SECRET || !secretsEqual(context.req.header("X-Publish-Secret") ?? "", context.env.PUBLISH_SECRET)) {
    return context.json({ error: "Invalid publish credentials." }, 401);
  }
  const body = industryFundFlowPublishSchema.safeParse(await context.req.json());
  if (!body.success) return context.json({ error: "Invalid industry fund-flow payload.", details: body.error.flatten() }, 400);
  const { dataDate, source, rows, persistHistory } = body.data;
  const now = new Date().toISOString();
  const latestStatements = rows.map((row) =>
    context.env.DB.prepare(
      `INSERT INTO industry_fund_flow_latest (
         industry, data_date, source, inflow_amount, outflow_amount, net_inflow,
         company_count, pct_change, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(industry) DO UPDATE SET data_date=excluded.data_date, source=excluded.source,
         inflow_amount=excluded.inflow_amount, outflow_amount=excluded.outflow_amount,
         net_inflow=excluded.net_inflow, company_count=excluded.company_count,
         pct_change=excluded.pct_change, updated_at=excluded.updated_at`,
    ).bind(row.industry, dataDate, source, row.inflowAmount, row.outflowAmount, row.netInflow, row.companyCount, row.pctChange, now),
  );
  const historyStatements = persistHistory ? rows.map((row) =>
    context.env.DB.prepare(
      `INSERT INTO industry_fund_flow_daily (
         industry, data_date, source, inflow_amount, outflow_amount, net_inflow,
         company_count, pct_change, fetched_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(industry, data_date) DO UPDATE SET source=excluded.source,
         inflow_amount=excluded.inflow_amount, outflow_amount=excluded.outflow_amount,
         net_inflow=excluded.net_inflow, company_count=excluded.company_count,
         pct_change=excluded.pct_change, fetched_at=excluded.fetched_at`,
    ).bind(row.industry, dataDate, source, row.inflowAmount, row.outflowAmount, row.netInflow, row.companyCount, row.pctChange, now),
  ) : [];
  try {
    const statements = [...latestStatements, ...historyStatements];
    for (let index = 0; index < statements.length; index += 100) await context.env.DB.batch(statements.slice(index, index + 100));
    return context.json({ status: "completed", rowCount: rows.length, dataDate, source, persistHistory, updatedAt: now });
  } catch (error) {
    return context.json({ error: error instanceof Error ? error.message.slice(0, 500) : "Industry fund-flow persistence failed." }, 500);
  }
});

app.post("/api/internal/publish-realtime-quotes", async (context) => {
  if (!context.env.PUBLISH_SECRET || !secretsEqual(context.req.header("X-Publish-Secret") ?? "", context.env.PUBLISH_SECRET)) {
    return context.json({ error: "Invalid publish credentials." }, 401);
  }
  const body = realtimeQuotePublishSchema.safeParse(await context.req.json());
  if (!body.success) return context.json({ error: "Invalid real-time quote payload.", details: body.error.flatten() }, 400);

  const now = new Date().toISOString();
  const statements = body.data.quotes.flatMap((quote) => {
    if (quote.instrumentType === "index") {
      return context.env.DB.prepare(
        `UPDATE market_index_latest
            SET name = COALESCE(NULLIF(?, ''), name), close = ?, pct_change = ?, quote_date = ?,
                quote_time = ?, quote_source = ?, quote_updated_at = ?
          WHERE code = ?`,
      ).bind(quote.name ?? "", quote.close, quote.pctChange, quote.quoteDate, quote.quoteTime, quote.quoteSource, now, quote.code);
    }
    return [
      context.env.DB.prepare(
        `UPDATE stock_latest
            SET name = COALESCE(NULLIF(?, ''), name), close = ?, quote_pct_change = ?, quote_date = ?,
                quote_time = ?, quote_source = ?, quote_updated_at = ?
          WHERE code = ? AND instrument_type = ?`,
      ).bind(quote.name ?? "", quote.close, quote.pctChange, quote.quoteDate, quote.quoteTime, quote.quoteSource, now, quote.code, quote.instrumentType),
    ];
  });
  try {
    for (let index = 0; index < statements.length; index += 100) {
      await context.env.DB.batch(statements.slice(index, index + 100));
    }
    return context.json({ status: "completed", rowCount: body.data.quotes.length, updatedAt: now });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown real-time quote publish error";
    return context.json({ error: "Real-time quote publication failed.", details: message }, 500);
  }
});

app.get("/api/saved-strategies", async (context) => {
  const user = await requireUser(context);
  if (user instanceof Response) return user;
  const rows = await context.env.DB.prepare(
    "SELECT id, name, rule_json, created_at, updated_at FROM saved_strategies WHERE user_id = ? ORDER BY updated_at DESC",
  ).bind(user.id).all<{ id: string; name: string; rule_json: string; created_at: string; updated_at: string }>();
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
  const user = await requireUser(context);
  if (user instanceof Response) {
    return user;
  }
  const rows = await context.env.DB.prepare(
    `SELECT w.code, w.source, w.added_at, w.observation_trade_date, w.observation_close,
            s.name, s.trade_date, s.close, s.score_total
       FROM watchlist_items w
       JOIN stock_latest s ON s.code = w.code
      WHERE w.user_id = ?
      ORDER BY w.added_at DESC`,
  )
    .bind(user.id)
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
    "SELECT code, name, trade_date, close, score_total FROM stock_latest WHERE code = ?",
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
            s.name, s.close, s.trade_date AS latest_trade_date
       FROM recommendation_snapshots r
       JOIN stock_latest s ON s.code = r.code
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
