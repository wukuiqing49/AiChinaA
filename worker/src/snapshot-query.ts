import { snapshotTables } from "./snapshot-tables";

export class SnapshotUnavailable extends Error {}

export async function snapshotQuery(db: D1Database, requested?: string) {
  const active = requested
    ? await db.prepare("SELECT run_id FROM dataset_runs WHERE run_id=? AND dataset='screener' AND status='completed' AND COALESCE(json_extract(meta_json,'$.runKind'),'full_market')='full_market'").bind(requested).first<{run_id:string}>()
    : await db.prepare("SELECT run_id FROM dataset_active WHERE dataset='screener'").first<{run_id:string}>();
  if (requested && !active) throw new SnapshotUnavailable("数据版本已过期，请重新加载第一页。");
  if (!active) return {sql:"",bindings:[] as string[],snapshotId:null};
  const fresh="q.quote_date || 'T' || q.quote_time >= COALESCE(b.quote_date,b.trade_date) || 'T' || COALESCE(b.quote_time,'00:00:00')";
  const columns=snapshotTables.stock_snapshot.map((column)=>{
    if (["name","close","quote_date","quote_time","quote_source","quote_updated_at","quote_pct_change"].includes(column)) {
      const source=column==="quote_updated_at" ? "updated_at" : column==="quote_pct_change" ? "pct_change" : column;
      return `CASE WHEN ${fresh} THEN COALESCE(q.${source},b.${column}) ELSE b.${column} END AS ${column}`;
    }
    return `b.${column}`;
  });
  return {snapshotId:active.run_id,bindings:[active.run_id,active.run_id],sql:`WITH
    stock_current AS (SELECT ${columns.join(",")} FROM stock_snapshot b LEFT JOIN live_quotes q ON q.code=b.code AND q.instrument_type=b.instrument_type WHERE b._run_id=?),
    stock_screen_current AS (SELECT ${snapshotTables.screen_snapshot.join(",")} FROM screen_snapshot WHERE _run_id=?) `};
}
