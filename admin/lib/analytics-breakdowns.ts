// Analytics breakdowns for the organizer dashboard: flow by zone, by hour of the event
// day and by party type. Pure (no database) so admin/engine/analytics-breakdowns-test.mjs
// covers the bucketing and the small-count suppression.
//
// Privacy: inputs are already stripped of session ids; outputs are counts only. Any visitor
// count from 1 to SMALL_COUNT_THRESHOLD - 1 is hidden (`count: null`), and so are enough of the
// smallest other buckets that subtracting the visible ones from a total never reveals a small
// count (see suppressColumn). Zero stays visible: an empty bucket identifies no one.

export const SMALL_COUNT_THRESHOLD = 5;
export const DEFAULT_TIMEZONE = "Asia/Riyadh";

export type SuppressedCount = { count: number | null; display: string; suppressed: boolean };

export function suppressCount(value: number, threshold = SMALL_COUNT_THRESHOLD): SuppressedCount {
  const n = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  if (n > 0 && n < threshold) return { count: null, display: `<${threshold}`, suppressed: true };
  return { count: n, display: String(n), suppressed: false };
}

/** Shown for every hidden cell of a breakdown, whether it was small or hidden alongside one. */
export const HIDDEN_DISPLAY = "مخفي";

/**
 * Suppresses one column of a breakdown (all buckets of one metric in one dimension).
 *
 * Primary suppression hides every count from 1 to threshold - 1. Because the dashboard also shows
 * the column's total, `total - visible cells` would give back the sum of the hidden cells, and a
 * single hidden cell would be exposed exactly. Complementary suppression therefore also hides the
 * smallest visible non-zero cells until at least two cells are hidden and their sum reaches the
 * threshold. Every hidden cell is labelled the same, so the complement cannot be told apart.
 */
export function suppressColumn(values: number[], threshold = SMALL_COUNT_THRESHOLD): SuppressedCount[] {
  const counts = values.map((value) => (Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0));
  const hidden = counts.map((n) => n > 0 && n < threshold);
  let hiddenCount = hidden.filter(Boolean).length;
  let hiddenSum = counts.reduce((sum, n, index) => sum + (hidden[index] ? n : 0), 0);
  if (hiddenCount > 0) {
    const candidates = counts
      .map((n, index) => ({ n, index }))
      .filter(({ n, index }) => n > 0 && !hidden[index])
      .sort((a, b) => a.n - b.n || a.index - b.index);
    for (const { n, index } of candidates) {
      if (hiddenCount >= 2 && hiddenSum >= threshold) break;
      hidden[index] = true;
      hiddenCount += 1;
      hiddenSum += n;
    }
  }
  return counts.map((n, index) => (hidden[index]
    ? { count: null, display: HIDDEN_DISPLAY, suppressed: true }
    : { count: n, display: String(n), suppressed: false }));
}

/** The venue's IANA timezone when it is valid, otherwise Asia/Riyadh. */
export function resolveTimeZone(timezone: string | null | undefined) {
  if (!timezone) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

const hourFormatters = new Map<string, Intl.DateTimeFormat>();
/** Hour of the day (0–23) of `date` on the wall clock of `timezone`. */
export function localHour(date: Date, timezone: string) {
  let formatter = hourFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hourCycle: "h23" });
    hourFormatters.set(timezone, formatter);
  }
  const hour = Number(formatter.formatToParts(date).find((part) => part.type === "hour")?.value);
  return Number.isInteger(hour) ? hour % 24 : 0;
}

export type HourSeries = { sessions: Date[]; itineraries: Date[]; interactions: Date[] };
export type HourRow = { hour: number; label: string; sessions: SuppressedCount; itineraries: SuppressedCount; interactions: SuppressedCount };

function hourCounts(dates: Date[], timezone: string) {
  const counts = new Array<number>(24).fill(0);
  for (const date of dates) counts[localHour(date, timezone)] += 1;
  return counts;
}

/**
 * Twenty-four rows, one per local hour, starting at `startHour` (the local hour of the window
 * start) so a 24-hour window reads in time order across midnight.
 */
export function buildHourBreakdown(series: HourSeries, timezone: string, startHour = 0, threshold = SMALL_COUNT_THRESHOLD): HourRow[] {
  const sessions = hourCounts(series.sessions, timezone);
  const itineraries = hourCounts(series.itineraries, timezone);
  const interactions = hourCounts(series.interactions, timezone);
  const first = ((Math.trunc(startHour) % 24) + 24) % 24;
  const sessionCells = suppressColumn(sessions, threshold);
  const itineraryCells = suppressColumn(itineraries, threshold);
  const interactionCells = suppressColumn(interactions, threshold);
  return Array.from({ length: 24 }, (_, offset) => {
    const hour = (first + offset) % 24;
    return {
      hour,
      label: `${String(hour).padStart(2, "0")}:00`,
      sessions: sessionCells[hour],
      itineraries: itineraryCells[hour],
      interactions: interactionCells[hour],
    };
  });
}

export const PARTY_TYPES = ["solo", "couple", "family", "friends", "other", "unspecified"] as const;
export type PartyType = (typeof PARTY_TYPES)[number];

export const PARTY_TYPE_LABELS: Record<PartyType, string> = {
  solo: "زائر بمفرده",
  couple: "شخصان",
  family: "عائلة مع أطفال",
  friends: "أصدقاء",
  other: "مجموعة أخرى",
  unspecified: "لم يحدد",
};

/**
 * Classifies the stored `companions` answer (free text up to 40 characters; the visitor app
 * offers لحالي / شريكي / عائلة وأطفال / أصدقاء). The text itself is never returned.
 */
export function partyTypeOf(companions: string | null | undefined, youngestChildAge?: number | null): PartyType {
  if (youngestChildAge != null) return "family";
  const text = companions?.trim();
  if (!text) return "unspecified";
  if (/family|child|kid|أطفال|طفل|عائلة|عائله/i.test(text)) return "family";
  if (/solo|alone|فردي|لحالي|بمفرد/i.test(text)) return "solo";
  if (/couple|partner|spouse|شريك|زوج|شخصين|اثنين/i.test(text)) return "couple";
  if (/friend|أصدقاء|اصدقاء|اصحاب|أصحاب|ربع|شلة/i.test(text)) return "friends";
  return "other";
}

export type PartyInput = { companions: string | null; partySize: number | null; youngestChildAge: number | null };
export type PartyRow = { type: PartyType; label: string; sessions: SuppressedCount; avgPartySize: number | null };

/** One row per party type, in a fixed order. The average size is withheld for suppressed rows. */
export function buildPartyBreakdown(rows: PartyInput[], threshold = SMALL_COUNT_THRESHOLD): PartyRow[] {
  const buckets = new Map<PartyType, { sessions: number; sizeTotal: number; sized: number }>();
  for (const row of rows) {
    const type = partyTypeOf(row.companions, row.youngestChildAge);
    const bucket = buckets.get(type) ?? { sessions: 0, sizeTotal: 0, sized: 0 };
    bucket.sessions += 1;
    if (typeof row.partySize === "number" && row.partySize > 0 && row.partySize <= 50) {
      bucket.sizeTotal += row.partySize;
      bucket.sized += 1;
    }
    buckets.set(type, bucket);
  }
  const sessionCells = suppressColumn(PARTY_TYPES.map((type) => buckets.get(type)?.sessions ?? 0), threshold);
  return PARTY_TYPES.map((type, index) => {
    const bucket = buckets.get(type) ?? { sessions: 0, sizeTotal: 0, sized: 0 };
    const sessions = sessionCells[index];
    const avgPartySize = !sessions.suppressed && bucket.sized >= threshold ? Math.round((bucket.sizeTotal / bucket.sized) * 10) / 10 : null;
    return { type, label: PARTY_TYPE_LABELS[type], sessions, avgPartySize };
  });
}

export type ZoneInput = { id: string; name: string };
export type ZoneRow = {
  id: string;
  name: string;
  plannedStops: SuppressedCount;
  presentNow: SuppressedCount;
  interactions: SuppressedCount;
  avgCrowdLevel: number | null;
};

/**
 * One row per zone of the published catalog (plus any zone seen in the data but no longer
 * published), keyed by the zone's stable key so counts from older catalog versions add up.
 * `avgCrowdLevel` is a 0–1 occupancy ratio and is not a visitor count, so it is not suppressed.
 */
export function buildZoneBreakdown(
  zones: ZoneInput[],
  data: { plannedStops: Map<string, number>; presentNow: Map<string, number>; interactions: Map<string, number>; crowdLevel: Map<string, number> },
  names: Map<string, string> = new Map(),
  threshold = SMALL_COUNT_THRESHOLD,
): ZoneRow[] {
  const ordered = [...zones];
  const known = new Set(zones.map((zone) => zone.id));
  for (const source of [data.plannedStops, data.presentNow, data.interactions, data.crowdLevel]) {
    for (const id of source.keys()) {
      if (!known.has(id)) {
        known.add(id);
        ordered.push({ id, name: names.get(id) ?? id });
      }
    }
  }
  const column = (source: Map<string, number>) => suppressColumn(ordered.map((zone) => source.get(zone.id) ?? 0), threshold);
  const plannedCells = column(data.plannedStops);
  const presentCells = column(data.presentNow);
  const interactionCells = column(data.interactions);
  const rows = ordered.map((zone, index) => {
    const crowd = data.crowdLevel.get(zone.id);
    return {
      id: zone.id,
      name: zone.name,
      plannedStops: plannedCells[index],
      presentNow: presentCells[index],
      interactions: interactionCells[index],
      avgCrowdLevel: typeof crowd === "number" && Number.isFinite(crowd) ? Math.round(Math.min(1, Math.max(0, crowd)) * 100) / 100 : null,
    };
  });
  // Busiest first by planned stops; suppressed buckets sort as just under the threshold.
  const weight = (value: SuppressedCount) => value.count ?? threshold - 0.5;
  return rows.sort((a, b) => weight(b.plannedStops) - weight(a.plannedStops) || a.name.localeCompare(b.name, "ar"));
}

/** Adds `amount` to `map[key]`. */
export function addTo(map: Map<string, number>, key: string, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount);
}
