import { describe, expect, it } from "vitest";

import { calculateObservationTracking } from "../src/tracking";

describe("calculateObservationTracking", () => {
  it("calculates an observation return from a recorded entry close", () => {
    const tracking = calculateObservationTracking({ observationClose: 10, latestClose: 11.5 });
    expect(tracking.status).toBe("complete");
    expect(tracking.returnPct).toBeCloseTo(15);
  });

  it("keeps unavailable prices distinct from zero return", () => {
    expect(calculateObservationTracking({ observationClose: 10, latestClose: null })).toEqual({
      returnPct: null,
      status: "unavailable",
    });
  });
});
