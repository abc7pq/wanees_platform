import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Site } from "../engine/site.ts";
import { POSITION_MAX_ACCURACY_M, originPhrase, resolvePosition, spokenPositionValid, visitorPositionSchema } from "./visitor-position.ts";
import { acceptGpsSample, freshPosition, simulatedPosition } from "./visitor-position-client.ts";
import { guidePath, parseVisitorPath, tabPath, VISITOR_TABS } from "./visitor-routes.ts";

// Audit 2.1: every visitor screen has a URL, and the URL reads back to the same screen.
for (const tab of VISITOR_TABS) {
  const route = parseVisitorPath(tabPath("boulevard-world-demo", tab));
  assert.deepEqual(route, { slug: "boulevard-world-demo", tab, screen: "tab" }, `${tab} round-trips`);
}
assert.equal(tabPath("boulevard-world-demo", "assistant"), "/e/boulevard-world-demo");
assert.equal(tabPath("boulevard-world-demo", "itinerary"), "/e/boulevard-world-demo/plan");
assert.deepEqual(parseVisitorPath(guidePath("x", "service-toilets-africa")), { slug: "x", tab: "map", screen: "guide", targetId: "service-toilets-africa" });
assert.equal(parseVisitorPath("/e/x/call")?.screen, "call");
assert.equal(parseVisitorPath("/e/x/unknown")?.tab, "assistant", "an unknown screen opens «ونيس»");
assert.equal(parseVisitorPath("/demo"), null);
assert.equal(parseVisitorPath("/events/x"), null);
assert.equal(parseVisitorPath("/e/bad slug!"), null, "a slug outside the allowed characters is not a visitor route");

// Audit 3.1: the server trusts a position only when the node is on this event's open walkway graph,
// the fix is fresh and not too coarse.
const catalog = JSON.parse(readFileSync(new URL("../data/boulevard_world_2026.json", import.meta.url), "utf8"));
catalog.routeGraph = {
  nodes: [
    { id: "node-africa", type: "ZONE", label: "منطقة أفريقيا", zone: "africa", x: 219, y: -312, accessible: true, status: "open" },
    { id: "node-closed", type: "ZONE", label: "ممر مغلق", zone: "africa", x: 220, y: -300, accessible: true, status: "closed" },
    { id: "node-no-zone", type: "PATH", label: "", x: 233, y: -302, accessible: true, status: "open" },
  ],
  edges: [],
};
const site = new Site(catalog);
const now = new Date("2026-11-26T19:00:00Z");
const at = (secondsAgo) => new Date(now.getTime() - secondsAgo * 1000).toISOString();

const gps = resolvePosition(site, { nodeId: "node-africa", source: "gps", accuracyM: 20, capturedAt: at(10) }, now);
assert.equal(gps.ok, true);
assert.equal(gps.ok && gps.position.zone, "africa");
assert.equal(gps.ok && gps.position.ageSeconds, 10);
assert.deepEqual(resolvePosition(site, { nodeId: "node-elsewhere", source: "gps", capturedAt: at(1) }, now), { ok: false, reason: "unknown_node" }, "a node from another event is refused");
assert.deepEqual(resolvePosition(site, { nodeId: "node-closed", source: "gps", capturedAt: at(1) }, now), { ok: false, reason: "closed_node" });
assert.deepEqual(resolvePosition(site, { nodeId: "node-africa", source: "gps", capturedAt: at(121) }, now), { ok: false, reason: "stale" }, "GPS older than two minutes is stale");
assert.deepEqual(resolvePosition(site, { nodeId: "node-africa", source: "gps", accuracyM: POSITION_MAX_ACCURACY_M + 1, capturedAt: at(1) }, now), { ok: false, reason: "too_coarse" });
assert.deepEqual(resolvePosition(site, { nodeId: "node-africa", source: "gps", capturedAt: at(-120) }, now), { ok: false, reason: "future" });
assert.equal(resolvePosition(site, { nodeId: "node-africa", source: "spoken", capturedAt: at(19 * 60) }, now).ok, true, "a spoken position lasts 20 minutes");
assert.equal(resolvePosition(site, { nodeId: "node-africa", source: "kiosk", capturedAt: at(86_400 * 30) }, now).ok, true, "a kiosk never moves");
const unzoned = resolvePosition(site, { nodeId: "node-no-zone", source: "gps", capturedAt: at(1) }, now);
assert.equal(unzoned.ok && unzoned.position.zone, "africa", "a walkway node without a zone takes the nearest zone");

assert.equal(visitorPositionSchema.safeParse({ nodeId: "n", source: "gps", capturedAt: "yesterday" }).success, false);
assert.equal(visitorPositionSchema.safeParse({ nodeId: "n", source: "gps", capturedAt: now.toISOString(), lat: 24.7 }).success, false, "coordinates are never accepted");

assert.equal(spokenPositionValid({ zone: "africa", at: at(60) }, now, site), "africa");
assert.equal(spokenPositionValid({ zone: "africa", at: at(21 * 60) }, now, site), null);
assert.equal(spokenPositionValid({ zone: "atlantis", at: at(60) }, now, site), null);

assert.equal(originPhrase("gps", "منطقة أفريقيا", false), "من مكانك الحين عند منطقة أفريقيا");
assert.equal(originPhrase("kiosk", "x", false), "من هالشاشة");
assert.equal(originPhrase("spoken", "منطقة أفريقيا", true), "from منطقة أفريقيا, where you said you are");

// Audit 3.7 and 3.3, the phone's side.
assert.deepEqual(simulatedPosition("?gps=simulate&at=node-africa", now), { nodeId: "node-africa", accuracyM: 5, capturedAt: now.toISOString() });
assert.equal(simulatedPosition("?at=node-africa", now), null, "simulation needs gps=simulate");
assert.equal(simulatedPosition("?gps=simulate", now), null);
assert.equal(freshPosition({ nodeId: "n", accuracyM: 5, capturedAt: at(30) }, now.getTime())?.nodeId, "n");
assert.equal(freshPosition({ nodeId: "n", accuracyM: 5, capturedAt: at(200) }, now.getTime()), null);

const first = { nodeId: "a", accuracyM: 20, at: 0, x: 0, y: 0 };
assert.deepEqual(acceptGpsSample(null, first), { accept: true, approximate: false });
assert.deepEqual(acceptGpsSample(null, { ...first, accuracyM: 80 }), { accept: true, approximate: true }, "up to 150 m is approximate, not refused");
assert.equal(acceptGpsSample(null, { ...first, accuracyM: 200 }).reason, "too_coarse");
assert.equal(acceptGpsSample(first, { nodeId: "b", accuracyM: 20, at: 5_000, x: 30, y: 0 }).accept, true, "a short walk is accepted");
assert.equal(acceptGpsSample(first, { nodeId: "c", accuracyM: 10, at: 2_000, x: 400, y: 0 }).reason, "jump", "400 m in two seconds is a reflection");
assert.equal(acceptGpsSample(first, { nodeId: "c", accuracyM: 10, at: 200_000, x: 400, y: 0 }).accept, true, "the same distance over minutes is a real walk");

console.log("visitor routes and position tests passed");
