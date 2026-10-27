import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";
import type { Env } from "../src/types";
import { testDatabase } from "./database";

const opened: ReturnType<typeof testDatabase>[] = [];
beforeEach(()=>{vi.spyOn(console,"log").mockImplementation(()=>{});});
afterEach(() => { for (const db of opened.splice(0)) db.sqlite.close(); vi.restoreAllMocks(); });
const stock = {
  code: "600001", name: "Alpha", instrumentType: "stock", isSt: false,
  tradeDate: "2026-10-26", quoteDate: null, quoteTime: null, quoteSource: null,
  close: 10, scoreTotal: 80, dataCompleteness: 1, market: "SH", industry: "Test",
  pctChange: 1, turnoverRate: 2, ret5d: 0.01, ret20d: 0.03, ret60d: 0.04,
  ma20Slope: 0.1, volumeRatio20: 1.2, volatility20: 0.2,
};
function setup() {
  const db = testDatabase(); opened.push(db);
  const env = { DB: db.database, PUBLISH_SECRET: "secret" } as Env;
  const post = (dataset: string, body: unknown) => app.request(`/api/internal/publish-${dataset}`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Publish-Secret": "secret" }, body: JSON.stringify(body),
  }, env);
  const begin = (runId: string, count: number, kind = "full_market") => post("screener", {
    operation: "begin", runId, schemaVersion: 2, dataDate: "2026-10-26", expectedRows: count,
    expectedChunks: Math.ceil(count / 10), payloadHash: "a".repeat(64),
    meta: { tradeDate: "2026-10-26", runKind: kind, stockCount: count, indexCount: 0 },
  });
  const chunk = (runId: string, index: number, stocks: unknown[]) => post("screener", { operation: "chunk", runId, chunkIndex: index, payload: { stocks, indices: [] } });
  const commit = (runId: string) => post("screener", { operation: "commit", runId });
  return { ...db, env, post, begin, chunk, commit };
}
describe("versioned publication with real SQLite", () => {
  it("requires v2 and bounded chunks", async () => {
    const db = setup(); expect((await db.post("screener", { stocks: [stock] })).status).toBe(426);
    expect((await db.begin("run-large", 11)).status).toBe(200);
    expect((await db.chunk("run-large", 0, Array.from({ length: 11 }, () => stock))).status).toBe(413);
  });
  it("keeps old data visible during interruption and switches atomically after resume", async () => {
    const db = setup(); await db.begin("run-first", 1);
    expect((await db.chunk("run-first", 0, [stock])).status).toBe(200); expect((await db.commit("run-first")).status).toBe(200);
    await db.begin("run-second", 11);
    const rows = Array.from({ length: 11 }, (_, i) => ({ ...stock, code: String(600001 + i), close: 20 }));
    expect((await db.chunk("run-second", 0, rows.slice(0, 10))).status).toBe(200);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n,MAX(close) AS price FROM stock_current").get()).toMatchObject({ n: 1, price: 10 });
    expect((await db.commit("run-second")).status).toBe(409);
    expect(await (await db.post("screener", { operation: "status", runId: "run-second" })).json()).toMatchObject({ acceptedChunks: [0] });
    expect(await (await db.chunk("run-second", 0, rows.slice(0, 10))).json()).toMatchObject({ idempotent: true });
    await db.chunk("run-second", 1, rows.slice(10)); expect((await db.commit("run-second")).status).toBe(200);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n,MAX(close) AS price FROM stock_current").get()).toMatchObject({ n: 11, price: 20 });
    expect(db.sqlite.prepare("SELECT reference_close FROM recommendation_snapshots LIMIT 1").get()).toMatchObject({ reference_close: 10 });
    const response = await app.request("/api/screener", {}, db.env);
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ total: 11 });
  });
  it("rejects changed manifests and rolls back duplicate identities", async () => {
    const db = setup(); await db.begin("run-conflict", 11); await db.chunk("run-conflict", 0, [stock]);
    expect((await db.begin("run-conflict", 12)).status).toBe(409);
    expect((await db.chunk("run-conflict", 0, [{ ...stock, close: 12 }])).status).toBe(409);
    expect((await db.chunk("run-conflict", 1, [stock])).status).toBe(409);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM dataset_chunks").get()).toMatchObject({ n: 1 });
  });
  it("supplemental publishing preserves market membership and remains searchable", async () => {
    const db = setup(); await db.begin("run-full", 1); await db.chunk("run-full", 0, [stock]); await db.commit("run-full");
    await db.begin("run-extra", 1, "supplemental_st"); await db.chunk("run-extra", 0, [{ ...stock, code: "600002", isSt: true }]); await db.commit("run-extra");
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM stock_current").get()).toMatchObject({ n: 1 });
    expect(await (await app.request("/api/screener?code=600002", {}, db.env)).json()).toMatchObject({ total: 1 });
  });
  it("old quotes cannot roll prices back", async () => {
    const db = setup(); await db.begin("run-quotes-base", 1); await db.chunk("run-quotes-base", 0, [stock]); await db.commit("run-quotes-base");
    async function quote(runId: string, time: string, price: number) {
      await db.post("realtime-quotes", { operation: "begin", schemaVersion: 2, runId, dataDate: "2026-10-27", expectedRows: 1, expectedChunks: 1, payloadHash: "b".repeat(64), meta: {} });
      return db.post("realtime-quotes", { operation: "chunk", runId, chunkIndex: 0, payload: { quotes: [{ code: stock.code, instrumentType: "stock", close: price, pctChange: 1, quoteDate: "2026-10-27", quoteTime: time, quoteSource: "tencent" }] } });
    }
    expect((await quote("run-new-quote", "15:00:00", 12)).status).toBe(200); expect((await quote("run-old-quote", "14:00:00", 11)).status).toBe(200);
    expect(db.sqlite.prepare("SELECT close,quote_date FROM stock_current").get()).toMatchObject({ close: 12, quote_date: "2026-10-27" });
  });
  it("late older market tasks cannot replace the active task", async () => {
    const db = setup(); await db.begin("run-old-market", 1); await db.chunk("run-old-market", 0, [stock]);
    db.sqlite.exec("UPDATE dataset_runs SET started_at='2026-10-26T00:00:00.000Z' WHERE run_id='run-old-market'");
    await db.begin("run-new-market", 1); await db.chunk("run-new-market", 0, [{ ...stock, close: 15 }]); await db.commit("run-new-market"); await db.commit("run-old-market");
    expect(db.sqlite.prepare("SELECT run_id FROM dataset_active WHERE dataset='screener'").get()).toMatchObject({ run_id: "run-new-market" });
  });
  it.each([
    ["valuation","stock_valuation_current",{code:"600001",peTtm:12,pb:1,totalMarketCap:100,floatMarketCap:80}],
    ["industry-map","stock_industry_current",{code:"600001",industry:"Test"}],
    ["fund-flow","stock_money_flow_current",{code:"600001",mainNetInflow:10,mainNetInflowPct:1,superLargeNetInflow:null,largeNetInflow:null,mediumNetInflow:null,smallNetInflow:null,mainNetInflow3d:null,mainNetInflow5d:null,mainNetInflow10d:null}],
    ["financials","stock_financial_current",{code:"600001",reportDate:"2026-06-30",announcementDate:"2026-08-20",roe:10,revenueYoy:2,profitYoy:3,grossMargin:null,debtRatio:null,revenue:100,netProfit:10}],
    ["industry-fund-flow","industry_fund_flow_current",{industry:"Test",inflowAmount:100,outflowAmount:80,netInflow:20,companyCount:1,pctChange:1}],
  ] as const)("publishes %s using staged rows and an atomic pointer",async(dataset,table,row)=>{
    const db=setup(); const runId=`run-test-${dataset}`;
    const meta={source:"test",dataDate:"2026-10-27",reportDate:"2026-09-30",persistHistory:true};
    expect((await db.post(dataset,{operation:"begin",runId,schemaVersion:2,dataDate:"2026-10-27",expectedRows:1,expectedChunks:1,payloadHash:"a".repeat(64),meta})).status).toBe(200);
    expect((await db.post(dataset,{operation:"chunk",runId,chunkIndex:0,payload:{rows:[row]}})).status).toBe(200);
    expect(db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toMatchObject({n:0});
    expect((await db.post(dataset,{operation:"commit",runId})).status).toBe(200);
    expect(db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toMatchObject({n:1});
    if(dataset==="financials") expect(db.sqlite.prepare("SELECT report_date FROM stock_financial_current").get()).toMatchObject({report_date:"2026-06-30"});
    if(dataset==="industry-fund-flow") expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM industry_fund_flow_daily").get()).toMatchObject({n:1});
  });
  it("pins pagination to a completed version and checks every rule dependency",async()=>{
    const db=setup(); await db.begin("run-pin-old",1); await db.chunk("run-pin-old",0,[stock]); await db.commit("run-pin-old");
    await db.begin("run-pin-new",1); await db.chunk("run-pin-new",0,[{...stock,code:"600002"}]); await db.commit("run-pin-new");
    const response=await app.request("/api/screener?snapshotId=run-pin-old",{},db.env);
    const data=await response.json() as {snapshotId:string;items:{code:string}[]};
    expect(data.snapshotId).toBe("run-pin-old"); expect(data.items[0].code).toBe(stock.code);
    const rule=await app.request("/api/rule-screener",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({conditions:[{field:"mainNetInflow",op:">=",value:0},{field:"roe",op:">=",value:0}]})},db.env);
    expect(rule.status).toBe(409); expect(await rule.json()).toMatchObject({missing:["moneyFlow","financial"]});
  });
  it("publishes all 6000 rows with bounded requests and no missing intermediate chunks",async()=>{
    const db=setup(); await db.begin("run-full-6000",6000);
    for(let index=0;index<600;index++) {
      const rows=Array.from({length:10},(_,offset)=>({...stock,code:String(600000+index*10+offset)}));
      expect((await db.chunk("run-full-6000",index,rows)).status).toBe(200);
    }
    expect((await db.commit("run-full-6000")).status).toBe(200);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM stock_current").get()).toMatchObject({n:6000});
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM dataset_chunks").get()).toMatchObject({n:600});
  },30000);
  it("limits login before password derivation",async()=>{
    const db=setup(); db.env.AUTH_LIMITER={limit:async()=>({success:false})};
    const response=await app.request("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"tester",password:"password123"})},db.env);
    expect(response.status).toBe(429); expect(response.headers.get("Retry-After")).toBe("60");
  });

  it("expires abandoned refreshes and ignores callbacks after a terminal state",async()=>{
    const db=setup(); db.env.REFRESH_CALLBACK_SECRET="callback-secret";
    db.sqlite.exec("INSERT INTO data_refresh_runs(id,status,requested_by,requested_at) VALUES('00000000-0000-4000-8000-000000000001','queued','tester','2000-01-01T00:00:00.000Z')");
    expect(()=>db.sqlite.exec("INSERT INTO data_refresh_runs(id,status,requested_by,requested_at) VALUES('duplicate','running','tester','2000-01-01T00:00:00.000Z')")).toThrow(/UNIQUE/);
    expect((await app.request("/api/data-refresh",{},db.env)).status).toBe(200);
    expect(db.sqlite.prepare("SELECT status FROM data_refresh_runs WHERE id='00000000-0000-4000-8000-000000000001'").get()).toMatchObject({status:"failed"});
    const callback=()=>app.request("/api/internal/data-refresh-callback",{method:"POST",headers:{"Content-Type":"application/json","X-Refresh-Secret":"callback-secret"},body:JSON.stringify({id:"00000000-0000-4000-8000-000000000001",status:"running"})},db.env);
    expect(await (await callback()).json()).toMatchObject({status:"failed",ignored:true});
  });

  it("cleans old staged rows in bounded steps while preserving active data and identities",async()=>{
    const db=setup();
    for(const runId of ["run-clean-old","run-clean-recent","run-clean-active"]) {
      await db.begin(runId,1); await db.chunk(runId,0,[stock]); await db.commit(runId);
    }
    db.sqlite.exec("UPDATE dataset_runs SET started_at='2000-01-01T00:00:00.000Z' WHERE run_id='run-clean-old'");
    for(let n=0;n<10;n++) {
      const response=await app.request("/api/internal/cleanup-datasets",{method:"POST",headers:{"X-Publish-Secret":"secret"}},db.env);
      expect(response.status).toBe(200);
      const result=await response.json() as {status:string;deletedRows:number};
      expect(result.deletedRows).toBeLessThanOrEqual(100);
      if(result.status==="completed") break;
    }
    expect(db.sqlite.prepare("SELECT run_id FROM dataset_runs WHERE run_id='run-clean-old'").get()).toBeUndefined();
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM stock_current").get()).toMatchObject({n:1});
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM stock_latest").get()).toMatchObject({n:1});
  });

});
