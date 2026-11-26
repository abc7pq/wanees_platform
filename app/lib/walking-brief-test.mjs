import assert from "node:assert/strict";
import { Site } from "../engine/site.ts";
import { catalogData } from "../data/catalog.ts";
import { describeWalkingBrief, fuzzyActivityTarget, likelyOriginZone, walkingBrief } from "./walking-brief.ts";

const site = new Site(catalogData);

// Everyday wording → the catalog's activity
assert.equal(fuzzyActivityTarget("خذني لعرض الدلافين", site), "dolphinarium");
assert.equal(fuzzyActivityTarget("وين الزرافة", site), "giraffe");
assert.equal(fuzzyActivityTarget("ودني مدرسة التزلج", site), "ski_school");
// Generic words alone never pick an activity, and unknown places abstain
assert.equal(fuzzyActivityTarget("وديني عرض", site), null);
assert.equal(fuzzyActivityTarget("كيف اوصل لجريندايزر", site), null);

// Origin: started stop wins, then the start point, then the zone nearest a gate
assert.equal(likelyOriginZone(site, [{ zone: "egypt", start: 1000, end: 1030 }, { zone: "japan", start: 1100, end: 1130 }], 1050, "france"), "egypt");
assert.equal(likelyOriginZone(site, [{ zone: "japan", start: 1100, end: 1130 }], 1050, "france"), "france");

// Brief over a tiny graph: N→S detours west around a crowded east side and says so
const graphSite = new Site({
  ...catalogData,
  zones: [
    { id: "n", name: "شمال", x: 0, y: -100, popularity: 0.5 },
    { id: "e", name: "شرق", x: 100, y: 0, popularity: 0.5 },
    { id: "s", name: "جنوب", x: 0, y: 100, popularity: 0.5 },
    { id: "w", name: "غرب", x: -100, y: 0, popularity: 0.5 },
  ],
  activities: [],
  routeGraph: {
    nodes: ["n", "e", "s", "w"].map((id) => ({ id: `zone-${id}`, label: id, type: "ZONE", x: 0, y: 0, status: "open", zone: id })),
    edges: [["n", "e"], ["e", "s"], ["s", "w"], ["w", "n"]].flatMap(([a, b]) => [
      { from: `zone-${a}`, to: `zone-${b}`, walkMin: 3, distanceM: 150, status: "open", accessible: true },
      { from: `zone-${b}`, to: `zone-${a}`, walkMin: 3, distanceM: 150, status: "open", accessible: true },
    ]),
  },
});
const brief = walkingBrief(graphSite, { originZone: "n", targetId: "zone-s", targetName: "جنوب", targetNodeId: "zone-s", targetZone: "s" }, new Map([["e", 0.95]]));
assert.equal(brief?.totalWalkMin, 6);
assert.deepEqual(brief?.via, ["غرب"]);
assert.deepEqual(brief?.avoided, ["شرق"]);
assert.match(describeWalkingBrief(brief), /تجنب زحمة شرق/);

// A measured 2-minute edge stays 2 minutes even when the event's planning buffer (min_walk_min) is 4
const shortSite = new Site({
  ...catalogData,
  site: { ...catalogData.site, min_walk_min: 4 },
  zones: [{ id: "a", name: "أ", x: 0, y: 0, popularity: 0.5 }, { id: "b", name: "ب", x: 50, y: 0, popularity: 0.5 }],
  activities: [],
  routeGraph: {
    nodes: ["a", "b"].map((id) => ({ id: `zone-${id}`, label: id, type: "ZONE", x: 0, y: 0, status: "open", zone: id })),
    edges: [
      { from: "zone-a", to: "zone-b", walkMin: 2, distanceM: 120, status: "open", accessible: true },
      { from: "zone-b", to: "zone-a", walkMin: 2, distanceM: 120, status: "open", accessible: true },
    ],
  },
});
assert.equal(walkingBrief(shortSite, { originZone: "a", targetId: "zone-b", targetName: "ب", targetNodeId: "zone-b", targetZone: "b" }, new Map())?.totalWalkMin, 2);

console.log("walking brief + fuzzy place matching: all assertions passed");
