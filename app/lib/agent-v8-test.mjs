// Agent v8: 12-hour times, the zone-first opening, and a route that is this visitor's own.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Site } from "../engine/site.ts";
import { buildRoute, eligible } from "../engine/route.ts";
import { clockLabel } from "./ar-count.ts";
import { PERSONA_VERSION, buildVisitorBrief, clockText, compactSources, personaInstructions } from "./agent-persona.ts";
import { instantPlanDraft, openingDraft, planZoneNames } from "./conversation-plan.ts";
import { applyUnderstanding, moodQuestion, understandMessage } from "./visitor-understanding.ts";
import { profileFromPreferences } from "./visitor-profile.ts";
import { seededZonePicks, validZonePicks, zoneOptionRows, zoneOptions, zoneSource } from "./zone-picks.ts";
import { mergeAssistantContext, readAssistantContext, contextExpiresAt } from "./assistant-context.ts";
import { buildAssistantSurface, validateA2uiMessages } from "./a2ui.ts";
import { buildCallInstructions } from "./realtime-session.ts";
import { FOCUS_ZONE_BONUS, isUnpersonalized, seededShuffle, seededUnit, varietyBonus } from "../../packages/engine/src/variety.ts";

const catalog = JSON.parse(readFileSync(new URL("../data/boulevard_world_2026.json", import.meta.url), "utf8"));
const site = () => new Site(catalog);
const profileFor = (...messages) => {
  let preferences = null;
  for (const message of messages) preferences = applyUnderstanding(preferences, understandMessage(message)).preferences;
  return profileFromPreferences(catalog, { ...(preferences ?? {}), startMinute: 1080, availableMinutes: preferences?.availableMinutes ?? 180 });
};
const ids = (plan) => plan.stops.map((stop) => stop.act_id).join(",");

// ————— 12-hour clock —————
assert.equal(clockLabel(1080), "6:00 م");
assert.equal(clockLabel(17 * 60 + 16), "5:16 م");
assert.equal(clockLabel(11 * 60), "11:00 ص");
assert.equal(clockLabel(12 * 60), "12:00 م", "noon");
assert.equal(clockLabel(0), "12:00 ص", "midnight");
assert.equal(clockLabel(25 * 60), "1:00 ص", "a venue open past midnight wraps");
assert.equal(clockLabel(1110, "en"), "6:30 PM");
assert.equal(clockText(1110), "6:30 م");
{
  const brief = buildVisitorBrief({ site: site(), profile: profileFor("معي عيالي"), plan: null, nowMin: 1080 });
  assert.match(brief, /الوقت الآن 6:00 م/);
  assert.doesNotMatch(brief, /\b(1[3-9]|2[0-3]):[0-5]\d\b/, "no 24-hour time reaches the model");
  const rows = compactSources([{ kind: "activity", name: "x", zoneName: "z", priceSar: 10, durationMin: 20, schedule: { type: "continuous", from: 1020, to: 1420 } }]);
  assert.equal(rows[0].المواعيد, "5:00 م–11:40 م");
}

// ————— persona v8 —————
assert.equal(PERSONA_VERSION, "wanees-agent-v8");
for (const channel of ["text", "voice", "call"]) {
  const text = personaInstructions(channel);
  assert.match(text, /البداية مدن، مو فعاليات/, `${channel}: the opening is about zones`);
  assert.match(text, /وش جوك الليلة/, `${channel}: asks the mood`);
  assert.match(text, /12 ساعة/, `${channel}: 12-hour times`);
  assert.match(text, /كل زائر غير/, `${channel}: no two visitors get the same suggestion`);
}
assert.match(personaInstructions("text"), /جملة أو جملتان قصيرتان/);
assert.doesNotMatch(personaInstructions("text"), /18:30/);

// ————— seeded variety is deterministic and bounded —————
assert.equal(seededUnit("a", "x"), seededUnit("a", "x"));
assert.notEqual(seededUnit("a", "x"), seededUnit("b", "x"));
{
  const units = Array.from({ length: 400 }, (_, index) => seededUnit(`seed${index}`, "activity"));
  assert.ok(units.every((value) => value >= 0 && value < 1));
  const mean = units.reduce((sum, value) => sum + value, 0) / units.length;
  assert.ok(mean > 0.42 && mean < 0.58, `seeded units spread over the range (mean ${mean.toFixed(2)})`);
  assert.deepEqual(seededShuffle([1, 2, 3, 4, 5], "s").sort(), [1, 2, 3, 4, 5]);
}

// ————— no seed → the planner is exactly as before —————
{
  const plain = profileFor("ابي مسار");
  assert.equal(isUnpersonalized(plain), true);
  const activity = [...site().activities.values()][0];
  assert.equal(varietyBonus(activity, plain), 0, "no seed and no focus: no bonus");
  assert.equal(ids(buildRoute(site(), plain)), ids(buildRoute(site(), plain)));
}

// ————— two visitors who said nothing do not get the same route; one visitor always gets theirs —————
{
  const base = profileFor("ابي مسار");
  const plans = new Map();
  for (let visitor = 0; visitor < 12; visitor += 1) {
    const seed = `session-${visitor}`;
    const options = zoneOptions(site(), { ...base, variety_seed: seed }, 1080);
    const focus = seededZonePicks(options, seed);
    assert.ok(focus.length >= 2 && focus.length <= 3, "two or three zones are picked");
    assert.deepEqual(validZonePicks(focus, options), focus, "every pick is a real option");
    const profile = { ...base, variety_seed: seed, focus_zones: focus };
    const plan = buildRoute(site(), profile);
    assert.ok(plan.stops.length >= 2, "a real plan");
    assert.equal(ids(plan), ids(buildRoute(site(), profile)), "the same visitor gets the same route again");
    // The picked zones are where the route actually goes.
    assert.ok(plan.stops.some((stop) => focus.includes(stop.zone)), `the route visits a picked zone (${seed})`);
    // Variety never bends a rule: every stop is still eligible and inside the visit.
    for (const stop of plan.stops) {
      assert.ok(eligible(site(), site().activities.get(stop.act_id), profile));
      assert.ok(stop.end <= profile.start_min + profile.duration_min);
    }
    plans.set(seed, ids(plan));
  }
  const distinct = new Set(plans.values()).size;
  assert.ok(distinct >= 6, `12 visitors with nothing said got ${distinct} different routes (expected at least 6)`);
}

// ————— a visitor who said what they like still gets it, whatever the seed —————
{
  const aviation = profileFor("معي ولدي عمره 6 سنين ويحب الطيارات");
  assert.equal(isUnpersonalized(aviation), false);
  for (let visitor = 0; visitor < 8; visitor += 1) {
    const seed = `family-${visitor}`;
    const options = zoneOptions(site(), { ...aviation, variety_seed: seed }, 1080);
    const profile = { ...aviation, variety_seed: seed, focus_zones: seededZonePicks(options, seed) };
    const plan = buildRoute(site(), profile);
    const tagged = plan.stops.map((stop) => site().activities.get(stop.act_id)).filter((activity) => (activity.tags ?? []).includes("طيران"));
    assert.ok(tagged.length >= 1, `the aviation fan gets an aviation stop (${seed})`);
    for (const stop of plan.stops) {
      const activity = site().activities.get(stop.act_id);
      assert.ok(activity.min_age === undefined || activity.min_age <= 6, `${activity.name} respects the child's age`);
    }
  }
  assert.ok(FOCUS_ZONE_BONUS < 60, "a focus zone never outweighs a stated interest");
}

// ————— zone options come from the catalog, for this visitor —————
{
  const s = site();
  const family = profileFor("معي عيالي أعمارهم 4 و7");
  const options = zoneOptions(s, family, 1080);
  assert.ok(options.length >= 5);
  for (const option of options) {
    assert.ok(s.zones.has(option.id));
    assert.equal(option.name, s.zones.get(option.id).name);
    assert.ok(option.activityCount >= 1, "only zones with something this visitor can do");
    assert.ok(option.flavours.length <= 3);
  }
  for (let index = 1; index < options.length; index += 1) assert.ok(options[index - 1].appeal >= options[index].appeal, "best fit first");
  // The model sees the options in a different order for every visit, and may only return ids from them.
  const orderA = zoneOptionRows(options, "visit-a").map((row) => row.id).join();
  const orderB = zoneOptionRows(options, "visit-b").map((row) => row.id).join();
  assert.notEqual(orderA, orderB);
  assert.deepEqual(validZonePicks(["not-a-zone", options[0].id, options[0].id, options[1].id], options), [options[0].id, options[1].id], "unknown and repeated ids are dropped");
  assert.deepEqual(validZonePicks(null, options), []);
  const row = compactSources([zoneSource(options[0], "v1")])[0];
  assert.equal(row.نوع, "منطقة");
  assert.equal(row.الاسم, options[0].name);
  // Zone cards show under the opening; activity cards never show under small talk.
  const surface = buildAssistantSurface({ surfaceId: "open", intent: "chat", sources: [zoneSource(options[0], "v1"), zoneSource(options[1], "v1"), { kind: "activity", id: "a", name: "نشاط" }] });
  assert.ok(surface, "the opening has zone cards");
  assert.deepEqual(validateA2uiMessages(surface), []);
  const items = surface[0].createSurface.dataModel.items.filter(Boolean);
  assert.equal(items.length, 2, "two zone cards, no activity card");
  assert.equal(buildAssistantSurface({ surfaceId: "talk", intent: "chat", sources: [{ kind: "activity", id: "a", name: "نشاط" }] }), null);
}

// ————— the opening in words: where to go and one question; never an activity —————
{
  const draft = openingDraft({ zoneNames: ["منطقة اليابان", "منطقة مصر", "منطقة إيطاليا والبندقية"], question: moodQuestion(null, "ar"), language: "ar" });
  assert.match(draft, /منطقة اليابان ومنطقة مصر ومنطقة إيطاليا والبندقية/);
  assert.match(draft, /وش جوك الليلة/);
  assert.doesNotMatch(draft, /«/, "no activity is named in the opening");
  assert.equal((draft.match(/؟/g) ?? []).length, 1, "one question");
  assert.match(openingDraft({ zoneNames: ["A", "B"], question: moodQuestion(null, "en"), language: "en" }), /A and B.*mood/);
  assert.equal(moodQuestion({ mood: "هادئ" }, "ar"), null, "a known mood is not asked again");
  assert.ok(openingDraft({ zoneNames: [], question: null, language: "ar" }).length > 5);
}

// ————— the plan in words: the zones it passes through come first —————
{
  const s = site();
  const profile = { ...profileFor("ابي مسار"), variety_seed: "plan-words" };
  const plan = buildRoute(s, profile);
  const zones = planZoneNames(plan, s);
  assert.ok(zones.length >= 1 && zones.length <= 3);
  const draft = instantPlanDraft({ plan, site: s, profile, assumptions: [], question: moodQuestion(null, "ar"), language: "ar" });
  assert.ok(draft.includes(`تمرّ على ${zones[0]}`), "the draft says where the route goes");
  assert.ok(draft.indexOf(zones[0]) < draft.indexOf(`«${plan.stops[0].name}»`), "zones before the first stop");
  assert.match(draft, /وش جوك الليلة/);
}

// ————— the picked zones are remembered for the visit, and reach the live call —————
{
  const context = mergeAssistantContext(null, { focusZones: ["japan", "egypt", "japan", "italy", "greece"] });
  assert.deepEqual(context.focusZones, ["japan", "egypt", "italy"], "at most three, no repeats");
  const kept = mergeAssistantContext(context, { callCount: 2 });
  assert.deepEqual(kept.focusZones, ["japan", "egypt", "italy"], "other updates keep them");
  assert.deepEqual(readAssistantContext(JSON.parse(JSON.stringify(kept)), contextExpiresAt()).focusZones, ["japan", "egypt", "italy"]);
  const call = buildCallInstructions({ visitorBrief: "x", suggestions: ["- «عرض»"], greeting: "هلا", zonePicks: ["- منطقة اليابان: تشتهر بـ أنمي"] });
  assert.match(call, /<zone_picks>[\s\S]*منطقة اليابان[\s\S]*<\/zone_picks>/);
  assert.ok(call.indexOf("<zone_picks>") < call.indexOf("<personal_picks>"), "where to go comes before what to do");
}

console.log("agent v8: 12-hour times, zone-first opening and per-visitor variety passed");
