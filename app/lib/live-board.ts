// Live venue board: turns the published catalog, aggregated crowd readings and active operator
// updates into what a screen at the gate should say. Pure and deterministic: no fetches, no
// clock reads, no visitor data. The page polls the public APIs and passes the results in.
import type { Catalog } from "@/engine/types.ts";

export type CrowdReading = {
  zone: string;
  level: number;
  source: string;
  quietestUpcomingHour?: number | null;
};

export type LiveUpdate = {
  updateType: string;
  targetType: string;
  targetId?: string | null;
  payload?: Record<string, unknown> | null;
};

export type BoardInput = {
  catalog: Catalog;
  crowd: CrowdReading[];
  /** Crowd level at or above which a zone counts as packed (the coordinator's threshold). */
  threshold: number;
  updates: LiveUpdate[];
  /** Event-local minutes since midnight. */
  nowMinute: number;
};

export type CrowdBand = "calm" | "busy" | "packed";

export type BoardZone = {
  id: string;
  name: string;
  level: number;
  band: CrowdBand;
  /** Plain-language source, so a simulated or estimated value is never shown as measured. */
  sourceLabel: string;
  measured: boolean;
  closed: boolean;
  activityCount: number;
  quietestUpcomingHour: number | null;
};

export type BoardNotice = {
  kind: "delay" | "closure" | "cancelled" | "crowd" | "info";
  title: string;
  reason: string | null;
};

export type BoardShow = {
  activityId: string;
  name: string;
  zoneName: string;
  scheduledMinute: number;
  startsMinute: number;
  delayMinutes: number;
  cancelled: boolean;
};

export type Board = {
  zones: BoardZone[];
  quietest: BoardZone[];
  notices: BoardNotice[];
  shows: BoardShow[];
  /** True when at least one zone reading is measured (sensors), not estimated or simulated. */
  anyMeasured: boolean;
};

const SOURCE_LABELS: Record<string, string> = {
  sensor: "مقاس",
  operator: "من المشغّل",
  simulation: "محاكاة",
  simulated: "محاكاة",
  estimate: "تقدير",
};

const CALM_BELOW = 0.45;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function reasonOf(update: LiveUpdate): string | null {
  const reason = record(update.payload).reason;
  return typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 200) : null;
}

function delayMinutesOf(update: LiveUpdate): number {
  const minutes = record(update.payload).minutes;
  // Same bounds as the planner (active-live-events.ts).
  return typeof minutes === "number" && Number.isFinite(minutes) ? Math.max(1, Math.min(240, Math.round(minutes))) : 15;
}

export function bandFor(level: number, threshold: number): CrowdBand {
  if (level >= threshold) return "packed";
  if (level < CALM_BELOW) return "calm";
  return "busy";
}

export function buildBoard(input: BoardInput): Board {
  const { catalog, threshold, nowMinute } = input;
  const zoneName = new Map(catalog.zones.map((zone) => [zone.id, zone.name]));
  const activity = new Map(catalog.activities.map((item) => [item.id, item]));
  const activityCount = new Map<string, number>();
  for (const item of catalog.activities) activityCount.set(item.zone, (activityCount.get(item.zone) ?? 0) + 1);

  const closedZones = new Set<string>();
  const cancelledActivities = new Set<string>();
  const delays = new Map<string, number>();
  const notices: BoardNotice[] = [];

  for (const update of input.updates) {
    const target = update.targetId ?? "";
    const reason = reasonOf(update);
    if (update.updateType === "CLOSURE" && update.targetType === "zone" && zoneName.has(target)) {
      closedZones.add(target);
      notices.push({ kind: "closure", title: `إغلاق مؤقت: ${zoneName.get(target)}`, reason });
    } else if (update.updateType === "CLOSURE" && update.targetType === "activity" && activity.has(target)) {
      cancelledActivities.add(target);
      notices.push({ kind: "closure", title: `متوقف مؤقتًا: ${activity.get(target)!.name}`, reason });
    } else if (update.updateType === "SCHEDULE_CHANGE" && update.targetType === "activity" && activity.has(target) && record(update.payload).cancelled === true) {
      cancelledActivities.add(target);
      notices.push({ kind: "cancelled", title: `أُلغي: ${activity.get(target)!.name}`, reason });
    } else if (update.updateType === "DELAY" && update.targetType === "activity" && activity.has(target)) {
      const minutes = delayMinutesOf(update);
      delays.set(target, Math.max(delays.get(target) ?? 0, minutes));
      notices.push({ kind: "delay", title: `تأخير ${minutes.toLocaleString("ar-SA")} دقيقة: ${activity.get(target)!.name}`, reason });
    } else if (update.updateType === "CROWD_OVERRIDE" && update.targetType === "zone" && zoneName.has(target)) {
      const level = record(update.payload).level;
      if (typeof level === "number" && level >= threshold) notices.push({ kind: "crowd", title: `زحام في ${zoneName.get(target)}`, reason });
    } else if (update.targetType === "event" && reason) {
      notices.push({ kind: "info", title: "تنبيه من إدارة الموقع", reason });
    }
    // Updates aimed at ids that are not in this catalog are not shown: no raw ids on a public screen.
  }

  const readings = new Map(input.crowd.map((reading) => [reading.zone, reading]));
  const zones: BoardZone[] = catalog.zones.map((zone) => {
    const reading = readings.get(zone.id);
    const level = Math.min(1, Math.max(0, reading?.level ?? 0));
    const source = reading?.source ?? "estimate";
    return {
      id: zone.id,
      name: zone.name,
      level,
      band: bandFor(level, threshold),
      sourceLabel: SOURCE_LABELS[source] ?? "تقدير",
      measured: source === "sensor",
      closed: closedZones.has(zone.id),
      activityCount: activityCount.get(zone.id) ?? 0,
      quietestUpcomingHour: reading?.quietestUpcomingHour ?? null,
    };
  });
  // Busiest first, so the screen leads with where not to go; stable by name.
  zones.sort((a, b) => Number(a.closed) - Number(b.closed) || b.level - a.level || a.name.localeCompare(b.name, "ar"));

  const quietest = zones
    .filter((zone) => !zone.closed && zone.band !== "packed" && zone.activityCount > 0)
    .sort((a, b) => a.level - b.level || (catalog.zones.find((z) => z.id === b.id)?.popularity ?? 0) - (catalog.zones.find((z) => z.id === a.id)?.popularity ?? 0) || a.id.localeCompare(b.id))
    .slice(0, 3);

  const shows: BoardShow[] = [];
  for (const item of catalog.activities) {
    if (item.type !== "show" || item.schedule.type !== "slots") continue;
    const delay = delays.get(item.id) ?? 0;
    const upcoming = [...item.schedule.slots].sort((a, b) => a - b).filter((slot) => slot + (delay || 0) + item.duration_min > nowMinute);
    upcoming.forEach((slot, index) => {
      // A delay moves the next performance; later ones keep their published time.
      const delayMinutes = index === 0 ? delay : 0;
      shows.push({
        activityId: item.id,
        name: item.name,
        zoneName: zoneName.get(item.zone) ?? "",
        scheduledMinute: slot,
        startsMinute: slot + delayMinutes,
        delayMinutes,
        cancelled: cancelledActivities.has(item.id) || closedZones.has(item.zone),
      });
    });
  }
  shows.sort((a, b) => a.startsMinute - b.startsMinute || a.name.localeCompare(b.name, "ar"));

  // The board has room for six performances. A delayed or cancelled show's next performance always
  // makes the list, so an operator update is never hidden behind other shows that start sooner.
  const BOARD_SHOWS = 6;
  const affected = shows.filter((show, index) =>
    (show.delayMinutes > 0 || show.cancelled) && shows.findIndex((other) => other.activityId === show.activityId) === index);
  const picked = new Set(affected.slice(0, BOARD_SHOWS));
  for (const show of shows) {
    if (picked.size >= BOARD_SHOWS) break;
    picked.add(show);
  }
  const boardShows = shows.filter((show) => picked.has(show));

  return { zones, quietest, notices, shows: boardShows, anyMeasured: zones.some((zone) => zone.measured) };
}

/** Event-local "h:mm" with Arabic-Indic digits. */
export function boardClock(minute: number): string {
  const total = ((Math.floor(minute) % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h.toLocaleString("ar-SA")}:${m.toLocaleString("ar-SA", { minimumIntegerDigits: 2 })}`;
}
