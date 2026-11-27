import assert from "node:assert/strict";
import { catalogData } from "../data/catalog.ts";
import { buildRoute } from "../engine/route.ts";
import { Site, defaultProfile } from "../engine/site.ts";
import { computeNudges } from "./nudges.ts";
import { clockLabel } from "./ar-count.ts";
import { actionToVisitorMessage, validateA2uiMessages, processA2uiMessages, resolveDynamic } from "./a2ui.ts";
import { nudgeEvents } from "./realtime-call.ts";

const site = new Site(catalogData);
const adult = { ...defaultProfile(), companions_kids: false };
const plan = buildRoute(site, adult);
assert.ok(plan.stops.length >= 2, "fixture plan has stops");
const next = plan.stops.find((stop) => stop.start > adult.start_min) ?? plan.stops[1];
const leaveAt = next.start - next.walk_min - 3;

// ————— closed venue or no plan: Wanees stays quiet —————
assert.deepEqual(computeNudges({ site, plan, profile: adult, nowMin: leaveAt, isOpen: false }), []);
assert.deepEqual(computeNudges({ site, plan: null, profile: adult, nowMin: leaveAt, isOpen: true }), []);

// ————— too early: nothing; inside the window: one nudge for the next stop —————
assert.equal(computeNudges({ site, plan, profile: adult, nowMin: leaveAt - 10, isOpen: true }).filter((n) => n.kind !== "visit_ending").length, 0);
const due = computeNudges({ site, plan, profile: adult, nowMin: leaveAt, isOpen: true }).filter((n) => n.kind !== "visit_ending");
assert.equal(due.length, 1);
const nudge = due[0];
const timed = site.activities.get(next.act_id).schedule.type === "slots";
assert.equal(nudge.kind, timed ? "show_soon" : "leave_now");
assert.equal(nudge.targetId, next.act_id);
assert.equal(nudge.id, `${nudge.kind}:${next.act_id}:${next.start}`, "a stable id so each nudge shows once");
assert.ok(nudge.text.includes(`«${next.name}»`), "names the stop");
assert.ok(nudge.text.includes(clockLabel(next.start)), "says the start time, 12-hour");
assert.match(clockLabel(next.start), /^\d{1,2}:\d{2} [صم]$/);
assert.deepEqual(validateA2uiMessages(nudge.ui), [], "the nudge card is valid A2UI");
const card = processA2uiMessages(nudge.ui);
assert.equal(card.components.get("nudge_btn0").action.event.name, "get_directions");
assert.equal(card.components.get("nudge_btn0").action.event.context.targetId, next.act_id);
assert.ok(String(resolveDynamic(card.components.get("nudge_title").text, card.data)).length > 0);
// after the stop starts, the nudge for it is gone
assert.ok(!computeNudges({ site, plan, profile: adult, nowMin: next.start, isOpen: true }).some((n) => n.id === nudge.id));

// ————— families and low-walking visitors are told earlier —————
const family = { ...adult, companions_kids: true };
assert.equal(computeNudges({ site, plan, profile: family, nowMin: leaveAt - 4, isOpen: true }).filter((n) => n.targetId === next.act_id).length, 1, "kids → 6-minute buffer");
assert.equal(computeNudges({ site, plan, profile: adult, nowMin: leaveAt - 4, isOpen: true, walkingTolerance: "low" }).filter((n) => n.targetId === next.act_id).length, 1, "low walking → 6-minute buffer");
assert.equal(computeNudges({ site, plan, profile: adult, nowMin: leaveAt - 4, isOpen: true }).filter((n) => n.targetId === next.act_id).length, 0, "default 3-minute buffer");

// ————— the visit is ending —————
const endMin = adult.start_min + adult.duration_min;
const ending = computeNudges({ site, plan, profile: adult, nowMin: endMin - 15, isOpen: true }).find((n) => n.kind === "visit_ending");
assert.ok(ending, "a nudge 15 minutes before the visit ends");
assert.match(ending.text, /15 دقيقة/);
assert.deepEqual(validateA2uiMessages(ending.ui), []);
assert.ok(!computeNudges({ site, plan, profile: adult, nowMin: endMin - 30, isOpen: true }).some((n) => n.kind === "visit_ending"), "not 30 minutes before");
const shorten = processA2uiMessages(ending.ui).components.get("nudge_btn0");
if (shorten) {
  assert.equal(shorten.action.event.name, "shorten_plan");
  assert.equal(actionToVisitorMessage({ name: "shorten_plan", surfaceId: "s", sourceComponentId: "nudge_btn0", timestamp: new Date().toISOString(), context: {} }, () => undefined), "قصّر الجولة");
}

// ————— during a live call the nudge is spoken as a system notice, not as the visitor —————
const events = nudgeEvents(nudge.text);
assert.equal(events[0].item.role, "system");
assert.match(events[0].item.content[0].text, /^<system_nudge>/);
assert.deepEqual(events[1], { type: "response.create" });

console.log("proactive nudge tests passed");
