// Kiosk screens (audit 5.2). A kiosk stands at one walkway node and signs in with a device token the
// organizer saw once (only its SHA-256 hash is stored). Its visits are anonymous: no cookie, no guest or
// registered memory, a 60-second idle reset, and every walking answer counts from the kiosk's node.
import { createHash, randomBytes } from "node:crypto";
import { KIOSK_IDLE_SECONDS, type AgentPosition } from "../../packages/contracts/src/index.ts";

export const KIOSK_TOKEN_HEADER = "x-wanees-kiosk-token";

export function createKioskToken() {
  return `wk_${randomBytes(32).toString("base64url")}`;
}

export function hashKioskToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function readKioskToken(request: Request) {
  const token = request.headers.get(KIOSK_TOKEN_HEADER)?.trim() ?? "";
  return /^wk_[A-Za-z0-9_-]{40,60}$/.test(token) ? token : null;
}

/** A kiosk visit is over once it has been idle for a minute; the next visitor starts fresh. */
export function kioskSessionIdle(lastSeenAt: Date, now: Date = new Date()) {
  return now.getTime() - lastSeenAt.getTime() > KIOSK_IDLE_SECONDS * 1000;
}

/** The kiosk's own node as the visitor's position; a kiosk never moves, so it is always fresh. */
export function kioskPosition(session: { channel?: string | null; kioskDevice?: { nodeKey: string } | null }, now: Date = new Date()): AgentPosition | null {
  if (session.channel !== "kiosk" || !session.kioskDevice) return null;
  return { nodeId: session.kioskDevice.nodeKey, source: "kiosk", capturedAt: now.toISOString() };
}
