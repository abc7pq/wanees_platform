// Where to go first (agent v8): the opening talks about the event's zones («مدن» البوليفارد), not single
// activities. Every option is computed from the published catalog for this visitor: only zones that
// hold something they can actually do now, with what the zone is known for taken from its
// activities' tags. The model may choose among these options; it never adds one.
import { eligible, interestScore, slotStart } from "../engine/route.ts";
import type { Site } from "../engine/site.ts";
import type { Activity, Profile } from "../engine/types.ts";
import { endMin } from "../engine/types.ts";
import { activityTags } from "../../packages/engine/src/matching.ts";
import { SUPPORTING_TYPES, seededUnit } from "../../packages/engine/src/variety.ts";

export type ZoneOption = {
  id: string;
  name: string;
  /** What the zone is known for, from its activities' published tags (most common first). */
  flavours: string[];
  /** Activities this visitor can do there in the time they have. */
  activityCount: number;
  walkMin: number;
  /** Forecast occupancy 0–1 at this minute (the planner's own estimate). */
  crowd: number;
  /** How well the zone suits this visitor; used for ranking only, never shown. */
  appeal: number;
};

const TYPE_FLAVOUR: Record<string, string> = { food: "مطاعم", show: "عروض", ride: "ألعاب", shopping: "تسوق", horror: "رعب" };

function flavoursOf(activities: readonly Activity[]) {
  const counts = new Map<string, number>();
  for (const activity of activities) {
    const labels = activityTags(activity).length ? activityTags(activity) : [TYPE_FLAVOUR[activity.type]].filter(Boolean);
    for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([label]) => label);
}

/** Zones with at least one activity this visitor can do before their visit ends, best fit first. */
export function zoneOptions(site: Site, profile: Profile, nowMin: number): ZoneOption[] {
  const byZone = new Map<string, Activity[]>();
  for (const activity of site.activities.values()) {
    if (profile.avoid.includes(activity.id) || !eligible(site, activity, profile)) continue;
    const arrive = Math.max(nowMin, profile.start_min) + site.travelMin(profile.start_zone, activity.zone);
    const start = slotStart(activity, arrive);
    if (start === null || start + activity.duration_min > endMin(profile)) continue;
    byZone.set(activity.zone, [...(byZone.get(activity.zone) ?? []), activity]);
  }
  const options: ZoneOption[] = [];
  for (const [zoneId, activities] of byZone) {
    const zone = site.zones.get(zoneId);
    if (!zone) continue;
    const walkMin = site.travelMin(profile.start_zone, zoneId);
    const crowd = site.crowd(zoneId, Math.max(nowMin, profile.start_min));
    const fit = activities
      .map((activity) => 60 * interestScore(activity, profile) + (profile.mood ? (activity.moods.includes(profile.mood) ? 25 : 6) : 12) + 10 * (activity.popularity ?? 0.5))
      .sort((a, b) => b - a)
      .slice(0, 3);
    // A zone worth sending someone to has something to see or do, not only shops and restaurants.
    const attractions = activities.filter((activity) => !SUPPORTING_TYPES.has(activity.type)).length;
    const appeal = fit.reduce((sum, value) => sum + value, 0) / 3 + Math.min(12, attractions * 4) - Math.min(12, walkMin * 0.8) - 20 * Math.max(0, crowd - 0.6);
    options.push({ id: zoneId, name: zone.name, flavours: flavoursOf(activities), activityCount: activities.length, walkMin, crowd, appeal });
  }
  return options.sort((a, b) => b.appeal - a.appeal || a.id.localeCompare(b.id));
}

/**
 * The deterministic pick, used when no model answers: a seeded weighted draw, so zones that suit the
 * visitor are likelier, and two visitors with the same (or no) profile still get different picks.
 */
export function seededZonePicks(options: readonly ZoneOption[], seed: string, count = 3): string[] {
  if (!options.length) return [];
  const best = options[0].appeal;
  return options
    .map((option) => {
      const weight = Math.exp((option.appeal - best) / 12);
      const unit = Math.max(1e-9, seededUnit(seed, `zone:${option.id}`));
      // Efraimidis–Spirakis: the largest keys form a weighted sample without replacement.
      return { id: option.id, key: Math.pow(unit, 1 / weight) };
    })
    .sort((a, b) => b.key - a.key || a.id.localeCompare(b.id))
    .slice(0, Math.min(count, options.length))
    .map((item) => item.id);
}

/**
 * The options the guide chooses from. A visitor who said what they like sees the best-fitting zones;
 * a visitor who said nothing sees a seeded shortlist, different for every visit, so the guide's taste
 * works on a different part of the venue each time instead of landing on the same favourites.
 */
export function zoneShortlist(options: readonly ZoneOption[], seed: string, personalized: boolean, size = 8): ZoneOption[] {
  if (options.length <= size) return [...options];
  if (personalized) return options.slice(0, size);
  const keep = new Set(seededZonePicks(options, `shortlist:${seed}`, size));
  return options.filter((option) => keep.has(option.id));
}

/** Keeps only ids that are real options, in the order given, without repeats. */
export function validZonePicks(picked: readonly string[] | null | undefined, options: readonly ZoneOption[], count = 3): string[] {
  const allowed = new Set(options.map((option) => option.id));
  return [...new Set((picked ?? []).filter((id) => allowed.has(id)))].slice(0, count);
}

/** The option list handed to the model: compact, and in a different order for every visit. */
export function zoneOptionRows(options: readonly ZoneOption[], seed: string) {
  return options
    .map((option) => ({ option, key: seededUnit(seed, `order:${option.id}`) }))
    .sort((a, b) => a.key - b.key)
    .map(({ option }) => ({
      id: option.id,
      name: option.name,
      known_for: option.flavours,
      things_to_do: option.activityCount,
      walk_min: option.walkMin,
      crowd_pct: Math.round(option.crowd * 100),
    }));
}

/** A zone as a source row: the facts the reply and its card may use. */
export function zoneSource(option: ZoneOption, catalogVersionId: string) {
  return {
    kind: "zone" as const,
    id: option.id,
    name: option.name,
    flavours: option.flavours,
    walkMin: option.walkMin,
    sourceRef: `catalog:${catalogVersionId}/zone:${option.id}`,
  };
}

/** «اليابان ومصر وإيطاليا» / "Japan, Egypt and Italy". */
export function joinNames(names: readonly string[], language: "ar" | "en" = "ar") {
  if (names.length <= 1) return names[0] ?? "";
  return language === "ar" ? names.join(" و") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
