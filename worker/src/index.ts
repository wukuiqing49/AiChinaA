import { getCookie, setCookie } from "hono/cookie";
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";

import { AuthError, createSession, verifyFixedCredentials, verifySession } from "./auth";
import { calculateObservationTracking } from "./tracking";
import type { Env, LatestStock, SessionUser } from "./types";

const app = new Hono<{ Bindings: Env }>();
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
  stocks: z.array(z.object({
    code: z.string().regex(/^\d{6}$/),
    name: z.string().min(1).max(80),
    instrumentType: z.enum(["stock", "etf"]),
    tradeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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
  })).min(1).max(6000),
  indices: z.array(z.object({
    code: z.string().min(6).max(12),
    name: z.string().min(1).max(80),
    tradeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    close: z.number().positive().nullable(),
    pctChange: z.number().nullable(),
    ret20d: z.number().nullable(),
    ma20Slope: z.number().nullable(),
    volatility20: z.number().min(0).nullable(),
  })).max(100).default([]),
});

app.get("/api/health", (context) => context.json({ status: "ok" }));

app.get("/api/screener", async (context) => {
  const parsed = screenerQuerySchema.safeParse(Object.fromEntries(new URL(context.req.url).searchParams));
  if (!parsed.success) {
    return context.json({ error: "筛选条件无效。", details: parsed.error.flatten() }, 400);
  }
  const query = parsed.data;
  const conditions: string[] = [];
  const bindings: (string | number)[] = [];
  if (query.code) {
    conditions.push("s.code LIKE ?");
    bindings.push(`${query.code}%`);
  }
  if (query.name) {
    conditions.push("s.name LIKE ?");
    bindings.push(`%${query.name}%`);
  }
  if (query.instrumentType) {
    conditions.push("s.instrument_type = ?");
    bindings.push(query.instrumentType);
  }
  if (query.market) {
    conditions.push("d.market = ?");
    bindings.push(query.market);
  }
  if (query.industry) {
    conditions.push("d.industry LIKE ?");
    bindings.push(`%${query.industry}%`);
  }
  addRange(conditions, bindings, "s.close", query.minPrice, query.maxPrice);
  addRange(conditions, bindings, "d.ret_20d", query.minRet20, query.maxRet20);
  if (query.minTurnover !== undefined) {
    conditions.push("d.turnover_rate >= ?");
    bindings.push(query.minTurnover);
  }
  if (query.maxVolatility !== undefined) {
    conditions.push("d.volatility_20 <= ?");
    bindings.push(query.maxVolatility);
  }
  if (query.minScore !== undefined) {
    conditions.push("s.score_total >= ?");
    bindings.push(query.minScore);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
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
    JOIN (SELECT trade_date FROM sync_runs WHERE status = 'completed' ORDER BY trade_date DESC LIMIT 1) current
      ON current.trade_date = s.trade_date
    ${where}`;
  const [rows, count, asOf] = await Promise.all([
    context.env.DB.prepare(
      `SELECT s.code, s.name, s.instrument_type, s.trade_date, s.close, s.score_total, s.data_completeness,
              d.market, d.industry, d.pct_change, d.turnover_rate, d.ret_5d, d.ret_20d,
              d.ret_60d, d.ma20_slope, d.volume_ratio_20, d.volatility_20
         ${baseSql}
        ORDER BY ${orderColumn} ${orderDirection}, s.code ASC
        LIMIT ? OFFSET ?`,
    ).bind(...bindings, query.pageSize, offset).all<ScreenerRow>(),
    context.env.DB.prepare(`SELECT COUNT(*) AS total ${baseSql}`).bind(...bindings).first<{ total: number }>(),
    context.env.DB.prepare("SELECT MAX(trade_date) AS trade_date FROM sync_runs WHERE status = 'completed'").first<{ trade_date: string | null }>(),
  ]);
  return context.json({
    items: rows.results.map(toScreenerItem),
    total: count?.total ?? 0,
    page: query.page,
    pageSize: query.pageSize,
    asOf: asOf?.trade_date ?? null,
  });
});

app.get("/api/market-indices", async (context) => {
  const rows = await context.env.DB.prepare(
    `SELECT code, name, trade_date, close, pct_change, ret_20d, ma20_slope, volatility_20
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

app.post("/api/internal/publish-screener", async (context) => {
  if (!context.env.PUBLISH_SECRET || !secretsEqual(context.req.header("X-Publish-Secret") ?? "", context.env.PUBLISH_SECRET)) {
    return context.json({ error: "发布凭据无效。" }, 401);
  }
  const body = screenerPublishSchema.safeParse(await context.req.json());
  if (!body.success) {
    return context.json({ error: "筛选发布包格式无效。", details: body.error.flatten() }, 400);
  }
  const { runId, tradeDate, stocks, indices } = body.data;
  const startedAt = new Date().toISOString();
  const existing = await context.env.DB.prepare("SELECT status, row_count FROM sync_runs WHERE run_id = ?").bind(runId).first<{ status: string; row_count: number }>();
  if (existing?.status === "completed") {
    return context.json({ runId, status: existing.status, rowCount: existing.row_count, idempotent: true });
  }
  await context.env.DB.prepare(
    `INSERT INTO sync_runs (run_id, trade_date, status, row_count, started_at)
     VALUES (?, ?, 'running', 0, ?)
     ON CONFLICT(run_id) DO UPDATE SET status = 'running', error_message = NULL, started_at = excluded.started_at`,
  ).bind(runId, tradeDate, startedAt).run();
  try {
    const statements = [
      ...stocks.flatMap((stock) => [
      context.env.DB.prepare(
        `INSERT INTO stock_latest (code, name, instrument_type, trade_date, close, score_total, data_completeness, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET name = excluded.name, instrument_type = excluded.instrument_type, trade_date = excluded.trade_date,
           close = excluded.close, score_total = excluded.score_total,
           data_completeness = excluded.data_completeness, updated_at = excluded.updated_at`,
      ).bind(stock.code, stock.name, stock.instrumentType, stock.tradeDate, stock.close, stock.scoreTotal, stock.dataCompleteness, startedAt),
      context.env.DB.prepare(
        `INSERT INTO stock_screen_latest (
           code, trade_date, market, industry, pct_change, turnover_rate, ret_5d, ret_20d,
           ret_60d, ma20_slope, volume_ratio_20, volatility_20, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET trade_date = excluded.trade_date, market = excluded.market,
           industry = excluded.industry, pct_change = excluded.pct_change, turnover_rate = excluded.turnover_rate,
           ret_5d = excluded.ret_5d, ret_20d = excluded.ret_20d, ret_60d = excluded.ret_60d,
           ma20_slope = excluded.ma20_slope, volume_ratio_20 = excluded.volume_ratio_20,
           volatility_20 = excluded.volatility_20, updated_at = excluded.updated_at`,
      ).bind(stock.code, stock.tradeDate, stock.market, stock.industry, stock.pctChange, stock.turnoverRate, stock.ret5d, stock.ret20d, stock.ret60d, stock.ma20Slope, stock.volumeRatio20, stock.volatility20, startedAt),
      ]),
      ...indices.map((index) => context.env.DB.prepare(
        `INSERT INTO market_index_latest (
           code, name, trade_date, close, pct_change, ret_20d, ma20_slope, volatility_20, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET name = excluded.name, trade_date = excluded.trade_date,
           close = excluded.close, pct_change = excluded.pct_change, ret_20d = excluded.ret_20d,
           ma20_slope = excluded.ma20_slope, volatility_20 = excluded.volatility_20, updated_at = excluded.updated_at`,
      ).bind(index.code, index.name, index.tradeDate, index.close, index.pctChange, index.ret20d, index.ma20Slope, index.volatility20, startedAt)),
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
  trade_date: string;
  close: number | null;
  score_total: number | null;
  data_completeness: number | null;
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
    tradeDate: row.trade_date,
    close: row.close,
    score: row.score_total,
    dataCompleteness: row.data_completeness,
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

function toMarketIndexItem(row: MarketIndexRow) {
  return {
    code: row.code,
    name: row.name,
    tradeDate: row.trade_date,
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
