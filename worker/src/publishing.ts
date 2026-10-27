import type { Hono } from "hono";
import { z } from "zod";
import type { Env } from "./types";
import {
  screenerPublishSchema, realtimeQuotePublishSchema, moneyFlowPublishSchema,
  industryFundFlowPublishSchema, valuationPublishSchema, industryPublishSchema,
  financialPublishSchema,
} from "./publish-schemas";
import { snapshotTables } from "./snapshot-tables";

export const MAX_CHUNK_ROWS = 10;
const MAX_REQUEST_BYTES = 64 * 1024;
const schemas: Record<string, z.ZodType> = {
  screener: screenerPublishSchema.extend({ stocks: screenerPublishSchema.shape.stocks.min(0) }),
  "realtime-quotes": realtimeQuotePublishSchema, "fund-flow": moneyFlowPublishSchema,
  "industry-fund-flow": industryFundFlowPublishSchema, valuation: valuationPublishSchema,
  "industry-map": industryPublishSchema, financials: financialPublishSchema,
};
const envelope = z.object({
  operation: z.enum(["begin", "chunk", "status", "commit"]),
  runId: z.string().regex(/^[A-Za-z0-9._-]{8,100}$/),
});
const manifest = envelope.extend({
  operation: z.literal("begin"), schemaVersion: z.literal(2),
  dataDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expectedRows: z.number().int().min(1).max(6100),
  expectedChunks: z.number().int().min(1).max(6100),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  meta: z.record(z.string(), z.unknown()),
});
interface Run {
  run_id: string; dataset: string; status: string; data_date: string; started_at: string; source_time: string;
  expected_rows: number; expected_chunks: number; payload_hash: string; meta_json: string;
}
type Row = Record<string, unknown>;
class PublishError extends Error {
  constructor(public code: string, message: string, public status: 400 | 409 | 413 | 426 = 400) { super(message); }
}
async function hash(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
function camel(column: string): string { return column.replace(/_(.)/g, (_, c: string) => c.toUpperCase()); }
function insertSnapshot(db: D1Database, table: string, run: Run, row: Row, meta: Row): D1PreparedStatement {
  const columns = snapshotTables[table];
  const values = columns.map((column) => {
    if (column === "updated_at" || column === "quote_updated_at") return run.source_time;
    if (column === "data_date") return run.data_date;
    if (column === "source") return meta.source;
    if (column === "report_date") return row.reportDate ?? meta.reportDate;
    if (column === "is_st") return row.isSt ? 1 : 0;
    if (column === "quote_pct_change") return row.pctChange ?? null;
    return row[camel(column)] ?? null;
  });
  return db.prepare(`INSERT INTO ${table} (_run_id, ${columns.join(",")})
    SELECT ${[run.run_id, ...values].map(() => "?").join(",")}
    WHERE EXISTS (SELECT 1 FROM dataset_runs WHERE run_id = ? AND status = 'running')`)
    .bind(run.run_id, ...values, run.run_id);
}
function chunkStatements(db: D1Database, run: Run, payload: Row, meta: Row): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  if (run.dataset === "screener") {
    for (const row of payload.stocks as Row[]) {
      // Stable identities preserve user foreign keys; readers use versioned views.
      statements.push(db.prepare(`INSERT INTO stock_latest
        (code,name,instrument_type,is_st,trade_date,close,updated_at)
        VALUES (?,?,?,?,?,?,?) ON CONFLICT(code) DO NOTHING`)
        .bind(row.code, row.name, row.instrumentType, row.isSt ? 1 : 0, row.tradeDate, null, run.started_at));
      statements.push(insertSnapshot(db, "stock_snapshot", run, row, meta));
      statements.push(insertSnapshot(db, "screen_snapshot", run, row, meta));
    }
    for (const row of payload.indices as Row[]) statements.push(insertSnapshot(db, "index_snapshot", run, row, meta));
  } else if (run.dataset === "realtime-quotes") {
    for (const row of payload.quotes as Row[]) statements.push(db.prepare(`INSERT INTO live_quotes
      (code,instrument_type,name,close,pct_change,quote_date,quote_time,quote_source,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(code,instrument_type) DO UPDATE SET
      name=COALESCE(excluded.name,live_quotes.name), close=excluded.close,pct_change=excluded.pct_change,
      quote_date=excluded.quote_date,quote_time=excluded.quote_time,quote_source=excluded.quote_source,
      updated_at=excluded.updated_at
      WHERE excluded.quote_date || 'T' || excluded.quote_time > live_quotes.quote_date || 'T' || live_quotes.quote_time`)
      .bind(row.code, row.instrumentType, row.name ?? null, row.close, row.pctChange, row.quoteDate, row.quoteTime, row.quoteSource, run.started_at));
  } else {
    const table = { "fund-flow": "fund_snapshot", valuation: "valuation_snapshot", financials: "financial_snapshot",
      "industry-map": "industry_snapshot", "industry-fund-flow": "sector_snapshot" }[run.dataset];
    if (!table) throw new PublishError("UNKNOWN_DATASET", "Unknown dataset");
    for (const row of payload.rows as Row[]) statements.push(insertSnapshot(db, table, run, row, meta));
  }
  return statements;
}
async function boundedJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new PublishError("INVALID_JSON", "Request body is required");
  const parts: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_REQUEST_BYTES) { await reader.cancel(); throw new PublishError("REQUEST_TOO_LARGE", "Use smaller publish chunks", 413); }
    parts.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  try { return {value:JSON.parse(new TextDecoder().decode(bytes)) as unknown,byteLength:size}; }
  catch { throw new PublishError("INVALID_JSON", "Invalid JSON"); }
}
async function progress(db: D1Database, run: Run) {
  const rows = await db.prepare("SELECT chunk_index,row_count FROM dataset_chunks WHERE run_id=? ORDER BY chunk_index")
    .bind(run.run_id).all<{ chunk_index: number; row_count: number }>();
  return { runId: run.run_id, status: run.status, acceptedChunks: rows.results.map((r) => r.chunk_index),
    rowCount: rows.results.reduce((sum, r) => sum + r.row_count, 0), expectedRows: run.expected_rows,
    expectedChunks: run.expected_chunks, maxChunkRows: MAX_CHUNK_ROWS };
}
export function registerPublishing(app: Hono<{ Bindings: Env }>) {
  for (const dataset of Object.keys(schemas)) app.post(`/api/internal/publish-${dataset}`, async (context) => {
    const requestId = crypto.randomUUID();
    const startedAt=performance.now();
    try {
      const supplied = context.req.header("X-Publish-Secret") ?? "";
      const secret = context.env.PUBLISH_SECRET;
      if (!secret || await hash(supplied) !== await hash(secret)) return context.json({ error: "Invalid publish credentials", code: "UNAUTHORIZED" }, 401);
      if (!schemas[dataset]) return context.json({ error: "Unknown dataset" }, 404);
      const body = await boundedJson(context.req.raw) as {value:Row;byteLength:number};
      const raw=body.value;
      const parsed = envelope.safeParse(raw);
      if (!parsed.success) throw new PublishError("PROTOCOL_UPGRADE_REQUIRED", "Publisher protocol v2 is required", 426);
      const { operation, runId } = parsed.data;
      const db = context.env.DB;
      if (operation === "begin") {
        const info = manifest.safeParse(raw);
        if (!info.success) throw new PublishError("INVALID_MANIFEST", "Invalid publish manifest");
        const m = info.data;
        if(m.expectedRows > (dataset === "screener" ? 6100 : dataset === "industry-fund-flow" ? 300 : 6000)) throw new PublishError("INVALID_MANIFEST","Too many rows");
        const quality=m.meta.quality as {coverage?:number} | undefined;
        if(quality?.coverage !== undefined && (!Number.isFinite(quality.coverage) || quality.coverage < (dataset === "screener" ? 0.98 : 0.8))) throw new PublishError("LOW_COVERAGE","Refusing an incomplete dataset");
        if (m.expectedChunks > m.expectedRows || m.expectedRows > m.expectedChunks * MAX_CHUNK_ROWS) throw new PublishError("INVALID_MANIFEST", "Invalid chunk counts");
        if (dataset === "screener" && (!Number.isInteger(m.meta.stockCount) || Number(m.meta.stockCount) < 1 || Number(m.meta.stockCount)>6000 || !Number.isInteger(m.meta.indexCount) || Number(m.meta.indexCount)<0 || Number(m.meta.indexCount)>100 || Number(m.meta.stockCount) + Number(m.meta.indexCount) !== m.expectedRows)) throw new PublishError("INVALID_MANIFEST", "Stock and index counts must match the manifest");
        const now=new Date().toISOString();
        if(m.meta.generatedAt !== undefined && !Number.isFinite(Date.parse(String(m.meta.generatedAt)))) throw new PublishError("INVALID_DATE","Invalid artifact timestamp");
        const sourceTime=m.meta.generatedAt === undefined ? now : new Date(String(m.meta.generatedAt)).toISOString();
        if(sourceTime>new Date(Date.now()+5*60*1000).toISOString()) throw new PublishError("INVALID_DATE","Artifact timestamp is in the future");
        await db.prepare(`INSERT INTO dataset_runs
          (run_id,dataset,status,data_date,expected_rows,expected_chunks,payload_hash,meta_json,started_at,source_time)
          VALUES (?,?,'running',?,?,?,?,?,?,?) ON CONFLICT(run_id) DO NOTHING`)
          .bind(runId, dataset, m.dataDate, m.expectedRows, m.expectedChunks, m.payloadHash, JSON.stringify(m.meta), now,sourceTime).run();
      }
      const run = await db.prepare("SELECT * FROM dataset_runs WHERE run_id=?").bind(runId).first<Run>();
      if (!run || run.dataset !== dataset) throw new PublishError("UNKNOWN_RUN", "Publish task does not exist", 409);
      const meta = JSON.parse(run.meta_json) as Row;
      if (operation === "begin") {
        if (run.payload_hash !== raw.payloadHash || run.meta_json !== JSON.stringify(raw.meta) || run.expected_rows !== raw.expectedRows || run.expected_chunks !== raw.expectedChunks || run.data_date !== raw.dataDate) throw new PublishError("MANIFEST_CONFLICT", "Run ID already has different content", 409);
        return context.json(await progress(db, run));
      }
      if (operation === "status") return context.json(await progress(db, run));
      if (operation === "chunk") {
        if (!Number.isInteger(raw.chunkIndex) || (raw.chunkIndex as number) < 0 || (raw.chunkIndex as number) >= run.expected_chunks || !raw.payload || typeof raw.payload !== "object") throw new PublishError("INVALID_CHUNK", "Invalid chunk");
        const payload = raw.payload as Row;
        const allowed = dataset === "screener" ? ["stocks", "indices"] : [dataset === "realtime-quotes" ? "quotes" : "rows"];
        if (Object.keys(payload).some((key) => !allowed.includes(key)) || allowed.some((key) => !Array.isArray(payload[key]))) throw new PublishError("INVALID_CHUNK", "Chunk may contain only row arrays");
        const rowCount = allowed.reduce((n, key) => n + (payload[key] as unknown[]).length, 0);
        if (rowCount < 1 || rowCount > MAX_CHUNK_ROWS) throw new PublishError("CHUNK_TOO_LARGE", `Chunks require 1-${MAX_CHUNK_ROWS} rows`, 413);
        const digest = await hash(payload);
        const existing = await db.prepare("SELECT payload_hash FROM dataset_chunks WHERE run_id=? AND chunk_index=?")
          .bind(runId, raw.chunkIndex).first<{ payload_hash: string }>();
        if (existing) {
          if (existing.payload_hash !== digest) throw new PublishError("CHUNK_CONFLICT", "Chunk already has different content", 409);
          return context.json({ runId, status: run.status, chunkIndex: raw.chunkIndex, idempotent: true });
        }
        if (run.status !== "running") throw new PublishError("RUN_CLOSED", "Publish task is closed", 409);
        const validated = schemas[dataset].safeParse({ ...meta, ...payload, runId });
        if (!validated.success) throw new PublishError("INVALID_ROWS", validated.error.message.slice(0, 500));
        const data = validated.data as Row;
        if (dataset === "screener" && (data.stocks as Row[]).some((r) => String(r.tradeDate) > run.data_date)) throw new PublishError("DATE_MISMATCH", "Stock factors cannot be newer than the snapshot date");
        const statements = chunkStatements(db, run, data, meta);
        for (const key of allowed) for (const row of data[key] as Row[]) {
          const identity = `${key}:${row.instrumentType ?? ""}:${row.code ?? row.industry}`;
          statements.push(db.prepare(`INSERT INTO dataset_items (run_id,item_key)
            SELECT ?,? WHERE EXISTS (SELECT 1 FROM dataset_runs WHERE run_id=? AND status='running')`).bind(runId,identity,runId));
        }
        statements.push(db.prepare(`INSERT INTO dataset_chunks (run_id,chunk_index,payload_hash,row_count)
          SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM dataset_runs WHERE run_id=? AND status='running')`)
          .bind(runId, raw.chunkIndex, digest, rowCount, runId));
        try { await db.batch(statements); }
        catch (error) {
          if (String(error).includes("UNIQUE constraint")) {
            const concurrent = await db.prepare("SELECT payload_hash FROM dataset_chunks WHERE run_id=? AND chunk_index=?").bind(runId,raw.chunkIndex).first<{payload_hash:string}>();
            if (concurrent?.payload_hash === digest) return context.json({runId,status:run.status,chunkIndex:raw.chunkIndex,idempotent:true});
            throw new PublishError("DUPLICATE_ROWS", "Duplicate row or changed chunk", 409);
          }
          throw error;
        }
        console.log(JSON.stringify({ requestId, runId, dataset, chunkIndex: raw.chunkIndex, rowCount, payloadBytes:body.byteLength,statements: statements.length,durationMs:performance.now()-startedAt }));
        return context.json({ runId, status: "running", chunkIndex: raw.chunkIndex, rowCount });
      }
      if (run.status !== "running") return context.json({ runId, status: run.status, idempotent: true });
      const state = await progress(db, run);
      if (state.rowCount !== run.expected_rows || state.acceptedChunks.length !== run.expected_chunks) throw new PublishError("INCOMPLETE_RUN", "Publish task is missing rows or chunks", 409);
      if (dataset === "screener") {
        const stocks=await db.prepare("SELECT COUNT(*) AS count FROM stock_snapshot WHERE _run_id=?").bind(runId).first<{count:number}>();
        if (stocks?.count !== meta.stockCount) throw new PublishError("INCOMPLETE_RUN", "Stock count does not match the manifest",409);
      }
      if (["fund-flow","valuation","financials","industry-map"].includes(dataset)) {
        const universe=await db.prepare("SELECT COUNT(*) AS count FROM stock_current WHERE instrument_type='stock'").first<{count:number}>();
        if(universe && run.expected_rows < universe.count*0.8) throw new PublishError("LOW_COVERAGE","Dataset covers less than 80% of the stock universe",409);
      }
      const supplemental = dataset === "screener" && (meta.runKind ?? "full_market") !== "full_market";
      const completedAt = new Date().toISOString();
      const statements = [db.prepare("UPDATE dataset_runs SET status='completed',completed_at=? WHERE run_id=? AND status='running'").bind(completedAt, runId)];
      if (!supplemental) statements.push(db.prepare(`INSERT INTO dataset_active (dataset,run_id,data_date,started_at,source_time)
        VALUES (?,?,?,?,?) ON CONFLICT(dataset) DO UPDATE SET run_id=excluded.run_id,data_date=excluded.data_date,started_at=excluded.started_at,source_time=excluded.source_time
        WHERE excluded.data_date > dataset_active.data_date OR (excluded.data_date=dataset_active.data_date AND excluded.source_time > dataset_active.source_time)`)
        .bind(dataset, runId, run.data_date, run.started_at,run.source_time));
      if(dataset==="industry-fund-flow" && meta.persistHistory===true) statements.push(db.prepare(`INSERT INTO industry_fund_flow_daily
        (industry,data_date,source,inflow_amount,outflow_amount,net_inflow,company_count,pct_change,fetched_at)
        SELECT industry,data_date,source,inflow_amount,outflow_amount,net_inflow,company_count,pct_change,updated_at
        FROM sector_snapshot WHERE _run_id=?
        ON CONFLICT(industry,data_date) DO UPDATE SET source=excluded.source,inflow_amount=excluded.inflow_amount,
        outflow_amount=excluded.outflow_amount,net_inflow=excluded.net_inflow,company_count=excluded.company_count,
        pct_change=excluded.pct_change,fetched_at=excluded.fetched_at
        WHERE excluded.fetched_at>industry_fund_flow_daily.fetched_at`).bind(runId));
      if (dataset === "screener") {
        statements.push(db.prepare(`INSERT INTO sync_runs (run_id,trade_date,run_kind,status,row_count,started_at,completed_at)
          SELECT ?,?,?,'completed',COUNT(*),?,? FROM stock_snapshot WHERE _run_id=?
          AND (? OR EXISTS (SELECT 1 FROM dataset_active WHERE dataset='screener' AND run_id=?))
          HAVING COUNT(*) > 0 ON CONFLICT(run_id) DO NOTHING`)
          .bind(runId, run.data_date, meta.runKind ?? "full_market", run.started_at, completedAt, runId, supplemental ? 1 : 0, runId));
        if (!supplemental) statements.push(db.prepare(`INSERT INTO recommendation_snapshots
          (id,trade_date,reference_trade_date,reference_close,code,rank,score,reasons_json,config_version,run_id,created_at)
          SELECT ? || ':' || code,?,?,close,code,ROW_NUMBER() OVER (ORDER BY score_total DESC,code),score_total,'[]','technical-v3',?,?
          FROM stock_snapshot WHERE _run_id=? AND is_st=0 AND close>0 AND score_total IS NOT NULL AND data_completeness=1
          AND EXISTS (SELECT 1 FROM dataset_active WHERE dataset='screener' AND run_id=?)
          AND NOT EXISTS (SELECT 1 FROM recommendation_snapshots WHERE trade_date=? AND config_version='technical-v3')
          ORDER BY score_total DESC,code LIMIT 10`)
          .bind(runId, run.data_date, run.data_date, runId, completedAt, runId, runId, run.data_date));
      }
      await db.batch(statements);
      console.log(JSON.stringify({requestId,runId,dataset,operation:"commit",rowCount:run.expected_rows,durationMs:performance.now()-startedAt}));
      return context.json({ runId, status: "completed", rowCount: run.expected_rows });
    } catch (error) {
      if (error instanceof PublishError) return context.json({ error: error.message, code: error.code, retryable: false, requestId }, error.status);
      console.error(JSON.stringify({ requestId, message: String(error).slice(0, 500) }));
      return context.json({ error: "Publish operation failed; resume using the same run ID", code: "PUBLISH_FAILED", retryable: true, requestId }, 503);
    }
  });
}
