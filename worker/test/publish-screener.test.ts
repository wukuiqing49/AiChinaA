import { describe, expect, it, vi } from "vitest";

import app from "../src/index";
import type { Env } from "../src/types";

const payload = {
  runId: "screener-2026-09-29-1",
  tradeDate: "2026-09-29",
  stocks: [{
    code: "600001", name: "Alpha", instrumentType: "stock", isSt: false,
    tradeDate: "2026-09-29", quoteDate: null, quoteTime: null, quoteSource: null,
    close: 10, scoreTotal: 80, dataCompleteness: 1, market: "SH", industry: "Test",
    pctChange: 1, turnoverRate: 2, ret5d: 1, ret20d: 3, ret60d: 4,
    ma20Slope: 0.1, volumeRatio20: 1.2, volatility20: 0.2,
  }],
};

function envWithExistingRun(status: "running" | "completed") {
  const first = vi.fn().mockResolvedValue({ status, row_count: 1 });
  const run = vi.fn().mockResolvedValue({ meta: { changes: 0 } });
  const prepare = vi.fn().mockReturnValue({ bind: vi.fn().mockReturnValue({ first, run }) });
  const batch = vi.fn();
  const env = { DB: { prepare, batch }, PUBLISH_SECRET: "test-secret" } as unknown as Env;
  return { env, prepare, batch };
}

describe("screener publish retries", () => {
  it("publishes a large payload across requests", async () => {
    const stocks = Array.from({ length: 600 }, (_, index) => ({
      ...payload.stocks[0], code: String(600001 + index),
    }));
    const run = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
    const first = vi.fn()
      .mockResolvedValueOnce({ status: "running", started_at: "2026-09-29T00:00:00.000Z", next_statement_index: 0, payload_hash: null })
      .mockResolvedValueOnce({ status: "running", started_at: "2026-09-29T00:00:00.000Z", next_statement_index: 1000, payload_hash: null });
    const prepare = vi.fn().mockReturnValue({ bind: vi.fn().mockReturnValue({ run, first }) });
    const batch = vi.fn().mockResolvedValue([]);
    const env = { DB: { prepare, batch }, PUBLISH_SECRET: "test-secret" } as unknown as Env;
    const request = () => app.request("/api/internal/publish-screener", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Publish-Secret": "test-secret" },
      body: JSON.stringify({ ...payload, stocks }),
    }, env);

    const firstResponse = await request();
    expect(firstResponse.status).toBe(202);
    expect(await firstResponse.json()).toMatchObject({ processedStatements: 1000, totalStatements: 1200 });

    const secondResponse = await request();
    expect(secondResponse.status).toBe(200);
    expect(await secondResponse.json()).toMatchObject({ status: "completed", rowCount: 600 });
    expect(batch).toHaveBeenCalledTimes(12);
    expect(batch.mock.calls.every(([statements]) => statements.length === 100)).toBe(true);
  });

  it("does not write a second time while the same run is active", async () => {
    const { env, prepare, batch } = envWithExistingRun("running");
    const response = await app.request("/api/internal/publish-screener", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Publish-Secret": "test-secret" },
      body: JSON.stringify(payload),
    }, env);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ runId: payload.runId });
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(batch).not.toHaveBeenCalled();
  });

  it("returns the completed result without writing again", async () => {
    const { env, batch } = envWithExistingRun("completed");
    const response = await app.request("/api/internal/publish-screener", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Publish-Secret": "test-secret" },
      body: JSON.stringify(payload),
    }, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      runId: payload.runId, status: "completed", rowCount: 1, idempotent: true,
    });
    expect(batch).not.toHaveBeenCalled();
  });

  it("rejects a changed payload for an existing run ID", async () => {
    const first = vi.fn().mockResolvedValue({ status: "running", payload_hash: "different-hash" });
    const run = vi.fn().mockResolvedValue({ meta: { changes: 0 } });
    const prepare = vi.fn().mockReturnValue({ bind: vi.fn().mockReturnValue({ first, run }) });
    const batch = vi.fn();
    const env = { DB: { prepare, batch }, PUBLISH_SECRET: "test-secret" } as unknown as Env;
    const response = await app.request("/api/internal/publish-screener", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Publish-Secret": "test-secret" },
      body: JSON.stringify(payload),
    }, env);

    expect(response.status).toBe(409);
    expect(batch).not.toHaveBeenCalled();
  });
});
