// Variety between visitors (agent v8). A planner that only ranks gives every visitor who says the
// same thing, or nothing, the same route. Here each visit carries a stable seed and a few focus
// zones chosen for that visitor; both are soft bonuses inside the planner, so every stop is still
// checked for age, budget, schedule and walking exactly as before.
//
// Deterministic: the same seed and profile always give the same numbers. No seed → no change.
import { profileTags } from "./matching.ts";
import type { Activity, Profile } from "./types.ts";

/** FNV-1a over `seed|key`, mapped to [0, 1). */
export function seededUnit(seed: string, key: string): number {
  let hash = 0x811c9dc5;
  const text = `${seed}|${key}`;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  // A final avalanche so keys that differ in one character spread over the whole range.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  return (hash >>> 0) / 0x1_0000_0000;
}

/** How much a focus zone lifts an activity: enough to pull the route there, less than a stated interest (60). */
export const FOCUS_ZONE_BONUS = 16;
/** Things a zone has around its attractions; they support a visit rather than make it. */
export const SUPPORTING_TYPES: ReadonlySet<string> = new Set(["food", "shopping"]);
/** Tie-breaking spread per activity: wide when nothing is known about the visitor, narrow once they told us what they like. */
export const JITTER_UNPERSONALIZED = 10;
export const JITTER_PERSONALIZED = 4;

/** The visitor has said nothing the planner can match on (no interests, no likes, no mood). */
export function isUnpersonalized(profile: Profile) {
  return profileTags(profile).length === 0 && !profile.mood;
}

export function varietyBonus(activity: Activity, profile: Profile): number {
  let bonus = 0;
  // What you go to a zone for (a show, a ride, an experience) gets the full lift; its shops and
  // restaurants get half, so a picked zone does not turn the route into a shopping trip.
  if (profile.focus_zones?.includes(activity.zone)) bonus += SUPPORTING_TYPES.has(activity.type) ? FOCUS_ZONE_BONUS / 2 : FOCUS_ZONE_BONUS;
  if (profile.variety_seed) {
    const spread = isUnpersonalized(profile) ? JITTER_UNPERSONALIZED : JITTER_PERSONALIZED;
    bonus += spread * seededUnit(profile.variety_seed, activity.id);
  }
  return bonus;
}

/** A seeded shuffle (Fisher–Yates), used to present options in a different order to each visitor. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const other = Math.floor(seededUnit(seed, `shuffle:${index}`) * (index + 1));
    [out[index], out[other]] = [out[other], out[index]];
  }
  return out;
}
