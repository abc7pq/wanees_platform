// Matching a visitor to activities (audit items 1.2 and 1.4). Deterministic: the planner ranks
// with these rules and the engine writes the reasons («لأن ولدك يحب الطيران»); the model only
// rephrases them.
import { isSensitiveTag, tagLabel } from "./tags.ts";
import type { Activity, Like, LikeWho, Profile } from "./types.ts";

/** Broad interests plus controlled tags: everything a visitor's interest can match. */
export function activityTags(activity: Activity): string[] {
  return activity.tags?.length ? [...new Set([...activity.interests, ...activity.tags])] : activity.interests;
}

/** Everything the visitor wants: chosen interests plus the tags of who likes what. */
export function profileTags(profile: Profile): string[] {
  return profile.likes?.length ? [...new Set([...profile.interests, ...profile.likes.map((like) => like.tag)])] : profile.interests;
}

/** Horror and other sensitive content (by tag or type). */
export function isSensitiveActivity(activity: Activity) {
  return activity.type === "horror" || (activity.tags ?? []).some(isSensitiveTag);
}

/** The visitor asked for this sensitive content themselves («نبي بيت رعب»). */
function askedFor(activity: Activity, profile: Profile) {
  const wanted = profileTags(profile);
  return (activity.tags ?? []).some((tag) => isSensitiveTag(tag) && wanted.includes(tag)) || (activity.type === "horror" && wanted.includes("رعب"));
}

/**
 * Age and content fit beyond the planner's basic rules:
 * - an activity whose minimum age is above the youngest child's age never fits;
 * - while the party or the children's ages are unknown (`cautious`), age-limited activities are skipped;
 * - sensitive content (horror) is offered to children or a cautious profile only when asked for;
 * - tags the visitor asked to avoid are skipped.
 */
export function fitsVisitor(activity: Activity, profile: Profile): boolean {
  const minAge = activity.min_age ?? 0;
  if (profile.youngest_child_age != null && minAge > profile.youngest_child_age) return false;
  if (profile.cautious && profile.youngest_child_age == null && minAge > 0) return false;
  if (isSensitiveActivity(activity) && (profile.cautious || profile.companions_kids) && !askedFor(activity, profile)) return false;
  if (profile.avoid_tags?.length && activityTags(activity).some((tag) => profile.avoid_tags!.includes(tag))) return false;
  return true;
}

const WHO_AR: Record<LikeWho, (tag: string) => string> = {
  self: (tag) => `لأنك تحب ${tag}`,
  group: (tag) => `لأنكم تحبون ${tag}`,
  son: (tag) => `لأن ولدك يحب ${tag}`,
  daughter: (tag) => `لأن بنتك تحب ${tag}`,
  child: (tag) => `لأن طفلك يحب ${tag}`,
  partner: (tag) => `لأن شريكك يحب ${tag}`,
  friends: (tag) => `لأن ربعك يحبون ${tag}`,
};
const WHO_EN: Record<LikeWho, (tag: string) => string> = {
  self: (tag) => `because you like ${tag}`,
  group: (tag) => `because you all like ${tag}`,
  son: (tag) => `because your son likes ${tag}`,
  daughter: (tag) => `because your daughter likes ${tag}`,
  child: (tag) => `because your child likes ${tag}`,
  partner: (tag) => `because your partner likes ${tag}`,
  friends: (tag) => `because your friends like ${tag}`,
};

/** «الطيران» reads better than «طيران» after يحب. */
function withArticle(tag: string) {
  return /^(ال|[a-z])/i.test(tag) || tag.includes(" ") ? tag : `ال${tag}`;
}

/**
 * Reasons this activity suits this visitor, built from who likes what. The most specific person
 * comes first (a child before the group), one reason per tag.
 */
export function fitReasons(activity: Activity, profile: Profile, language: "ar" | "en" = "ar"): string[] {
  const tags = new Set(activityTags(activity));
  const order: LikeWho[] = ["son", "daughter", "child", "partner", "friends", "self", "group"];
  const likes = [...(profile.likes ?? [])].filter((like) => tags.has(like.tag)).sort((a, b) => order.indexOf(a.who) - order.indexOf(b.who));
  const seen = new Set<string>();
  const reasons: string[] = [];
  for (const like of likes) {
    if (seen.has(like.tag)) continue;
    seen.add(like.tag);
    reasons.push(language === "en" ? WHO_EN[like.who](tagLabel(like.tag, "en")) : WHO_AR[like.who](withArticle(like.tag)));
  }
  return reasons;
}

/** Who in the party wants a tag, if anyone (used to explain a miss: «ما لقيت شي للطيران»). */
export function likesByTag(profile: Profile): Map<string, Like[]> {
  const map = new Map<string, Like[]>();
  for (const like of profile.likes ?? []) map.set(like.tag, [...(map.get(like.tag) ?? []), like]);
  return map;
}

/**
 * The price above which an activity is "premium": the 70th percentile of known positive prices.
 * With no budget given, the planner prefers activities at or under it (mid-price first).
 */
export function midPriceCap(activities: Iterable<Activity>): number | null {
  const prices = [...activities].filter((activity) => activity.price_known !== false && activity.price > 0).map((activity) => activity.price).sort((a, b) => a - b);
  if (!prices.length) return null;
  return prices[Math.min(prices.length - 1, Math.floor(prices.length * 0.7))];
}
