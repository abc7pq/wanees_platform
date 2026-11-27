import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Site } from "./site.ts";
import { buildRoute } from "./route.ts";
import { fitReasons, fitsVisitor, isSensitiveActivity } from "../../packages/engine/src/matching.ts";
import { applyUnderstanding, understandMessage } from "../lib/visitor-understanding.ts";
import { profileFromPreferences } from "../lib/visitor-profile.ts";

// Audit items 1.2 and 1.4 against the real 2026-27 Boulevard World catalog.
const catalog = JSON.parse(readFileSync(new URL("../data/boulevard_world_2026.json", import.meta.url), "utf8"));
const site = new Site(catalog);
const activities = [...site.activities.values()];
const profileFor = (...messages) => {
  let preferences = null;
  for (const message of messages) preferences = applyUnderstanding(preferences, understandMessage(message)).preferences;
  return profileFromPreferences(catalog, { ...preferences, startMinute: 1080, availableMinutes: preferences.availableMinutes ?? 180 });
};

// A 6-year-old aviation fan: aviation activities come with the engine's reason, and nothing above
// the child's age limit is ever planned or offered as a fit.
const aviation = profileFor("معي ولدي عمره 6 سنين ويحب الطيارات");
assert.equal(aviation.youngest_child_age, 6);
assert.deepEqual(aviation.likes, [{ who: "son", tag: "طيران" }]);
for (let run = 0; run < 3; run++) {
  const plan = buildRoute(site, aviation);
  assert.ok(plan.stops.length > 0);
  for (const stop of plan.stops) {
    const activity = site.activities.get(stop.act_id);
    assert.ok((activity.min_age ?? 0) <= 6, `${activity.id} needs age ${activity.min_age}`);
    assert.ok(!isSensitiveActivity(activity), `${activity.id} is sensitive`);
  }
}
for (const activity of activities.filter((item) => (item.min_age ?? 0) > 6)) assert.equal(fitsVisitor(activity, aviation), false, activity.id);
const flyer = activities.find((activity) => activity.tags?.includes("طيران") && (activity.min_age ?? 0) <= 6);
if (flyer) {
  assert.deepEqual(fitReasons(flyer, aviation), ["لأن ولدك يحب الطيران"]);
  assert.deepEqual(fitReasons(flyer, aviation, "en"), ["because your son likes aviation"]);
}

// A cold start with nothing known plans safely: no age-limited or horror activity.
const cold = profileFromPreferences(catalog, { startMinute: 1080 });
assert.equal(cold.cautious, true);
assert.equal(cold.prefer_mid_price, true);
const coldPlan = buildRoute(site, cold);
assert.ok(coldPlan.stops.length > 0, "a plan appears from a cold start");
for (const stop of coldPlan.stops) {
  const activity = site.activities.get(stop.act_id);
  assert.ok(!activity.min_age, `${activity.id} is age-limited`);
  assert.ok(!isSensitiveActivity(activity), `${activity.id} is horror`);
}

// Young men who ask for horror get it; the same request from a family does not unlock it for children.
const friends = profileFor("طلعة شباب ونحب الرعب");
assert.ok(activities.some((activity) => isSensitiveActivity(activity) && fitsVisitor(activity, friends)));
const family = profileFor("معي عيالي أعمارهم 5 و 8");
assert.ok(activities.filter(isSensitiveActivity).every((activity) => !fitsVisitor(activity, family)));

// «بدون X» removes X; an interest the event does not have is said plainly.
const noShows = profileFor("طلعة شباب", "بدون عروض");
assert.ok(buildRoute(site, noShows).stops.every((stop) => !(site.activities.get(stop.act_id).tags ?? []).includes("عروض")));
const anime = profileFor("لحالي وأحب الأنمي");
assert.ok(buildRoute(site, anime).explanations.includes("ما فيه نشاط «أنمي» في هذي الفعالية."));

// Different visitors get different nights.
const ids = (profile) => buildRoute(site, profile).stops.map((stop) => stop.act_id).join(",");
assert.notEqual(ids(aviation), ids(friends));
console.log("matching: age fit, safe defaults and engine reasons passed");
