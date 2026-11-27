// The phone's side of the visitor position (audit 3.1, 3.3, 3.7). Exact coordinates stay on the device:
// these helpers only ever hand on a walkway node id, its accuracy and when it was captured.

export type DevicePosition = { nodeId: string; accuracyM: number; capturedAt: string };

/** A position older than this is not sent; the server would reject it as stale anyway. */
export const DEVICE_POSITION_MAX_AGE_MS = 120_000;

/**
 * Staff and demo mode: `?gps=simulate&at=<nodeId>` stands the visitor at that walkway node, so the
 * «حولي» and «دلّني» flows can be rehearsed away from the venue. The server still validates the node.
 */
export function simulatedPosition(search: string, now = new Date()): DevicePosition | null {
  const params = new URLSearchParams(search);
  if (params.get("gps") !== "simulate") return null;
  const nodeId = params.get("at")?.trim();
  if (!nodeId || nodeId.length > 120) return null;
  return { nodeId, accuracyM: 5, capturedAt: now.toISOString() };
}

export function freshPosition(position: DevicePosition | null, now = Date.now()): DevicePosition | null {
  if (!position) return null;
  const age = now - new Date(position.capturedAt).getTime();
  return age >= 0 && age <= DEVICE_POSITION_MAX_AGE_MS ? position : null;
}

/**
 * GPS in a crowd (audit 3.3): a fix is accepted when it is accurate enough, and a jump that would mean
 * walking faster than a person can is ignored as a reflection off buildings. The last good node is kept.
 */
export type GpsSample = { nodeId: string; accuracyM: number; at: number; x: number; y: number };

export const GPS_APPROXIMATE_LIMIT_M = 150;
const MAX_WALKING_SPEED_MPS = 3;

export function acceptGpsSample(previous: GpsSample | null, next: GpsSample, metersPerUnit = 1): { accept: boolean; approximate: boolean; reason?: "too_coarse" | "jump" } {
  if (next.accuracyM > GPS_APPROXIMATE_LIMIT_M) return { accept: false, approximate: true, reason: "too_coarse" };
  const approximate = next.accuracyM > 30;
  if (!previous) return { accept: true, approximate };
  const seconds = Math.max(1, (next.at - previous.at) / 1000);
  const meters = Math.hypot(next.x - previous.x, next.y - previous.y) * metersPerUnit;
  // Allow the accuracy circles to overlap before calling it a jump.
  const allowed = MAX_WALKING_SPEED_MPS * seconds + previous.accuracyM + next.accuracyM;
  if (meters > allowed) return { accept: false, approximate, reason: "jump" };
  return { accept: true, approximate };
}

/** Retry delays for a GPS request that timed out: 2 s, 4 s, 8 s, then stop. */
export function gpsRetryDelays() {
  return [2_000, 4_000, 8_000];
}
