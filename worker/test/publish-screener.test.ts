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
});
