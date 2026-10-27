import type { Hono } from "hono";
import type { Env } from "./types";
import { snapshotTables } from "./snapshot-tables";

export function registerMaintenance(app:Hono<{Bindings:Env}>) {
  app.post("/api/internal/cleanup-datasets", async (context)=>{
    // Hash both secrets so comparison work is independent of the secret prefix.
    const digest=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text)))).join(",");
    if(!context.env.PUBLISH_SECRET || await digest(context.req.header("X-Publish-Secret") ?? "")!==await digest(context.env.PUBLISH_SECRET)) return context.json({error:"Unauthorized"},401);
    const db=context.env.DB;
    await db.prepare("UPDATE dataset_runs SET status='expired' WHERE status='running' AND started_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')").run();
    const candidate=await db.prepare(`SELECT r.run_id FROM dataset_runs r
      WHERE r.started_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-90 days')
      AND NOT EXISTS(SELECT 1 FROM dataset_active a WHERE a.run_id=r.run_id)
      AND (r.dataset!='screener' OR COALESCE(json_extract(r.meta_json,'$.runKind'),'full_market')='full_market' OR r.status='expired')
      AND r.run_id NOT IN (SELECT run_id FROM dataset_runs WHERE dataset=r.dataset AND status='completed' ORDER BY started_at DESC LIMIT 2)
      ORDER BY r.started_at LIMIT 1`).first<{run_id:string}>();
    if(!candidate) return context.json({status:"completed",deletedRows:0});
    // One bounded deletion per request; never delete user-owned identities.
    for(const table of [...Object.keys(snapshotTables),"dataset_items","dataset_chunks"]) {
      const key=table.startsWith("dataset_") ? "run_id" : "_run_id";
      const result=await db.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE ${key}=? LIMIT 100)`).bind(candidate.run_id).run();
      if(result.meta.changes) return context.json({status:"running",deletedRows:result.meta.changes,runId:candidate.run_id});
    }
    await db.prepare("DELETE FROM dataset_runs WHERE run_id=? AND NOT EXISTS(SELECT 1 FROM dataset_active WHERE run_id=?)").bind(candidate.run_id,candidate.run_id).run();
    return context.json({status:"running",deletedRows:1});
  });
}
