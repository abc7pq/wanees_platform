// Where the visitor is (audit 3.1). The phone snaps its GPS fix to the nearest walkway node on the
// device and sends only that node id: exact coordinates never leave the phone. A kiosk sends its own
// fixed node, and «انا عند X» in the chat sets a spoken position for 20 minutes. The server checks the
// node belongs to this event's published walkway graph, is open, and is fresh, before using it.
import { z } from "zod";
import type { Site } from "../engine/site.ts";

export const visitorPositionSchema = z.object({
  nodeId: z.string().trim().min(1).max(120),
  accuracyM: z.number().min(0).max(5_000).optional(),
  capturedAt: z.string().datetime({ offset: true }),
  source: z.enum(["gps", "kiosk", "spoken"]),
}).strict();
export type VisitorPosition = z.infer<typeof visitorPositionSchema>;

/** How long each kind of position is trusted. A kiosk never moves. */
export const POSITION_MAX_AGE_SECONDS = { gps: 120, spoken: 20 * 60, kiosk: Number.POSITIVE_INFINITY } as const;
/** A GPS fix coarser than this is treated as unknown (150 m is the «approximate» limit of item 3.3). */
export const POSITION_MAX_ACCURACY_M = 150;

export type ResolvedPosition = {
  nodeId: string;
  zone: string;
  label: string;
  source: VisitorPosition["source"];
  ageSeconds: number;
};

export type PositionRejection = "unknown_node" | "closed_node" | "stale" | "too_coarse" | "future";

export function resolvePosition(site: Site, position: VisitorPosition, now: Date): { ok: true; position: ResolvedPosition } | { ok: false; reason: PositionRejection } {
  const node = site.routeGraphNodes.get(position.nodeId);
  if (!node) return { ok: false, reason: "unknown_node" };
  if (node.status !== "open") return { ok: false, reason: "closed_node" };
  const captured = new Date(position.capturedAt).getTime();
  const ageSeconds = Math.round((now.getTime() - captured) / 1000);
  // A clock a little ahead on the phone is fine; a fix from the future is not.
  if (ageSeconds < -60) return { ok: false, reason: "future" };
  if (ageSeconds > POSITION_MAX_AGE_SECONDS[position.source]) return { ok: false, reason: "stale" };
  if (position.source === "gps" && position.accuracyM != null && position.accuracyM > POSITION_MAX_ACCURACY_M) return { ok: false, reason: "too_coarse" };
  const zone = node.zone ?? nearestZone(site, node.x, node.y);
  if (!zone) return { ok: false, reason: "unknown_node" };
  return { ok: true, position: { nodeId: node.id, zone, label: node.label || site.zones.get(zone)?.name || zone, source: position.source, ageSeconds: Math.max(0, ageSeconds) } };
}

function nearestZone(site: Site, x: number, y: number) {
  let best: { id: string; distance: number } | null = null;
  for (const zone of site.zones.values()) {
    const distance = Math.hypot(zone.x - x, zone.y - y);
    if (!best || distance < best.distance) best = { id: zone.id, distance };
  }
  return best?.id ?? null;
}

/** The phrase that names where distances are counted from (Arabic or English). */
export function originPhrase(source: ResolvedPosition["source"] | "stop" | "start_point" | "entrance" | "first_stop", placeName: string, english: boolean) {
  switch (source) {
    case "gps": return english ? `from where you are now, near ${placeName}` : `من مكانك الحين عند ${placeName}`;
    case "kiosk": return english ? "from this screen" : "من هالشاشة";
    case "spoken": return english ? `from ${placeName}, where you said you are` : `من عندك في ${placeName}`;
    case "stop": return english ? `from your current stop in ${placeName}` : `من محطتك الحالية في ${placeName}`;
    case "entrance": return english ? "from the gate" : "من البوابة";
    default: return english ? `from ${placeName}` : `من ${placeName}`;
  }
}

/** The spoken position kept in the assistant context, valid for 20 minutes. */
export type SpokenPosition = { zone: string; at: string };

export function spokenPositionValid(spoken: SpokenPosition | null | undefined, now: Date, site: Site) {
  if (!spoken || !site.zones.has(spoken.zone)) return null;
  const age = (now.getTime() - new Date(spoken.at).getTime()) / 1000;
  return age >= 0 && age <= POSITION_MAX_AGE_SECONDS.spoken ? spoken.zone : null;
}
