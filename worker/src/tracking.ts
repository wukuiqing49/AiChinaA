export type TrackingStatus = "complete" | "unavailable";

export interface TrackingPoint {
  observationClose: number;
  latestClose: number | null;
}

export function calculateObservationTracking(point: TrackingPoint): {
  returnPct: number | null;
  status: TrackingStatus;
} {
  if (point.latestClose === null || point.observationClose <= 0) {
    return { returnPct: null, status: "unavailable" };
  }
  return {
    returnPct: (point.latestClose / point.observationClose - 1) * 100,
    status: "complete",
  };
}
