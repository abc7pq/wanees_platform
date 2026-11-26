import assert from "node:assert/strict";
import { getEventClock } from "./event-clock.ts";
import { contextActivityCandidates, mergeAssistantContext, readAssistantContext } from "./assistant-context.ts";
import { Site } from "../engine/site.ts";
import { profileFromPreferences } from "./visitor-profile.ts";

const liveClock = getEventClock({
  now: new Date("2026-11-20T17:30:00.000Z"),
  startsAt: new Date("2026-11-01T14:00:00.000Z"),
  endsAt: new Date("2027-03-01T21:00:00.000Z"),
  timezone: "Asia/Riyadh",
  openingFrom: 17,
  openingTo: 24,
});
assert.equal(liveClock.nowMinute, 1230);
assert.equal(liveClock.isOpen, true);

const futureClock = getEventClock({
  now: new Date("2026-10-20T12:00:00.000Z"),
  startsAt: new Date("2026-11-01T14:00:00.000Z"),
  endsAt: new Date("2027-03-01T21:00:00.000Z"),
  timezone: "Asia/Riyadh",
  openingFrom: 17,
  openingTo: 24,
});
assert.equal(futureClock.nowMinute, 1020);
assert.equal(futureClock.source, "event_window");

const previousClockOverride = process.env.WANEES_ALLOW_CLOCK_OVERRIDE;
const previousClockMinute = process.env.WANEES_CLOCK_OVERRIDE_MINUTE;
try {
  process.env.WANEES_ALLOW_CLOCK_OVERRIDE = "true";
  process.env.WANEES_CLOCK_OVERRIDE_MINUTE = "1080";
  const overriddenClock = getEventClock({
    now: new Date("2026-11-20T20:30:00.000Z"),
    startsAt: new Date("2026-11-01T14:00:00.000Z"),
    endsAt: new Date("2027-03-01T21:00:00.000Z"),
    timezone: "Asia/Riyadh",
    openingFrom: 17,
    openingTo: 24,
  });
  assert.equal(overriddenClock.actualMinute, 1080);
  assert.equal(overriddenClock.nowMinute, 1080);
  assert.equal(overriddenClock.source, "server_clock");
} finally {
  if (previousClockOverride === undefined) delete process.env.WANEES_ALLOW_CLOCK_OVERRIDE;
  else process.env.WANEES_ALLOW_CLOCK_OVERRIDE = previousClockOverride;
  if (previousClockMinute === undefined) delete process.env.WANEES_CLOCK_OVERRIDE_MINUTE;
  else process.env.WANEES_CLOCK_OVERRIDE_MINUTE = previousClockMinute;
}

const graphSite = new Site({
  meta: { source: "test", note: "", currency: "SAR" },
  site: { name: "test", walking_speed_m_per_min: 60, min_walk_min: 1, opening: { from: 0, to: 1440 }, crowd_threshold: 0.75, base_crowd_curve: {} },
  zones: [
    { id: "a", name: "A", x: 0, y: 0, popularity: 0.5 },
    { id: "b", name: "B", x: 100, y: 0, popularity: 0.5 },
  ],
  activities: [],
  routeGraph: {
    nodes: [
      { id: "entrance", type: "ENTRANCE", label: "Entrance", x: 0, y: 0, zone: "a", accessible: true, status: "open" },
      { id: "mid", type: "LANDMARK", label: "Mid", x: 20, y: 0, accessible: true, status: "open" },
      { id: "zone-b", type: "ZONE", label: "B", x: 100, y: 0, zone: "b", accessible: true, status: "open" },
    ],
    edges: [
      { from: "entrance", to: "mid", distanceM: 20, walkMin: 3, accessible: true, status: "open" },
      { from: "mid", to: "zone-b", distanceM: 80, walkMin: 4, accessible: true, status: "open" },
      { from: "entrance", to: "zone-b", distanceM: 100, walkMin: 20, accessible: true, status: "open" },
    ],
  },
});
assert.equal(graphSite.shortestPathWalkMin("a", "b"), 7);
assert.equal(graphSite.travelMin("a", "b"), 7);

const sampleEventCatalog = {
  meta: { source: "test", note: "", currency: "SAR" },
  site: { name: "Sample event", walking_speed_m_per_min: 60, min_walk_min: 1, opening: { from: 17, to: 24 }, crowd_threshold: 0.75, base_crowd_curve: {} },
  zones: [{ id: "sample-zone", name: "الساحة الرئيسية", x: 0, y: 0, popularity: 0.5 }],
  activities: [],
  locations: [{ id: "sample-gate", label: "بوابة الساحة", type: "ENTRANCE", zone: "sample-zone", x: 0, y: 0, accessible: true, status: "open", aliases: [], sourceRef: "test" }],
};
assert.equal(profileFromPreferences(sampleEventCatalog, { startPointId: "sample-zone" }).start_zone, "sample-zone");
assert.equal(profileFromPreferences(sampleEventCatalog, { startPointId: "sample-gate" }).start_zone, "sample-zone");
assert.equal(profileFromPreferences(sampleEventCatalog, {}).start_zone, "sample-zone");

const base = new Date("2026-11-20T20:00:00.000Z");
const context = mergeAssistantContext(null, { lastSearchIds: ["one", "two"], lastSuggestedActivityId: "two" }, base);
assert.deepEqual(contextActivityCandidates(context, new Set(["one", "two"])), ["two", "one"]);
assert.ok(readAssistantContext(context, new Date(base.getTime() + 60_000), base));
assert.equal(readAssistantContext(context, new Date(base.getTime() - 1), base), null);

console.log("clock, temporary context, and route graph tests passed");
