import assert from "node:assert/strict";
import { buildWalkwayEdges, nearestNodeKey } from "./walkway-graph.ts";
import { Site } from "./site.ts";
import type { Catalog } from "./types.ts";

// Four zones around a lagoon at (0,0): north, east, south, west + a gate near the south.
const nodes = [
  { key: "zone-n", type: "ZONE", x: 0, y: -100 },
  { key: "zone-e", type: "ZONE", x: 100, y: 0 },
  { key: "zone-s", type: "ZONE", x: 0, y: 100 },
  { key: "zone-w", type: "ZONE", x: -100, y: 0 },
  { key: "gate", type: "ENTRANCE", x: 10, y: 140 },
];
// Diamond-shaped lagoon |x|+|y| < 70 at the centre.
const lagoon: [number, number][] = [[0, -70], [70, 0], [0, 70], [-70, 0]];
const edges = buildWalkwayEdges(nodes, { center: { x: 0, y: 0 }, metresPerUnit: 1, walkingSpeedMPerMin: 50, detourFactor: 1, obstacle: lagoon });
const pairs = new Set(edges.map((edge) => `${edge.from}>${edge.to}`));
// Walkways follow the shore: N-E, E-S, S-W, W-N — never straight across the water (N-S, E-W).
for (const [a, b] of [["zone-n", "zone-e"], ["zone-e", "zone-s"], ["zone-s", "zone-w"], ["zone-w", "zone-n"]]) {
  assert.ok(pairs.has(`${a}>${b}`) && pairs.has(`${b}>${a}`), `ring edge ${a}-${b}`);
}
assert.ok(!pairs.has("zone-n>zone-s") && !pairs.has("zone-e>zone-w"), "no edge crosses the lagoon");
assert.ok(pairs.has("gate>zone-s"), "gate attaches to its nearest zone");
assert.equal(edges.find((edge) => edge.from === "zone-n" && edge.to === "zone-e")?.walkMin, 3, "141 m at 50 m/min → 3 min");
assert.deepEqual(buildWalkwayEdges(nodes, { center: { x: 0, y: 0 }, metresPerUnit: 1, walkingSpeedMPerMin: 50, obstacle: lagoon }), buildWalkwayEdges([...nodes].reverse(), { center: { x: 0, y: 0 }, metresPerUnit: 1, walkingSpeedMPerMin: 50, obstacle: lagoon }), "deterministic regardless of input order");
assert.equal(nearestNodeKey(nodes, { x: 90, y: 10 }), "zone-e");

// An island zone in the water gets bridges to its two nearest shore zones only.
const withIsland = buildWalkwayEdges([...nodes, { key: "zone-i", type: "ZONE", x: 30, y: 0 }], { center: { x: 0, y: 0 }, metresPerUnit: 1, walkingSpeedMPerMin: 50, obstacle: lagoon });
const islandLinks = withIsland.filter((edge) => edge.from === "zone-i" && edge.to.startsWith("zone-")).map((edge) => edge.to).sort();
assert.equal(islandLinks.length, 2, "exactly two bridges");
assert.ok(islandLinks.includes("zone-e"), "island bridges to the nearest shore");

// Crowd-aware routing: N → S has two equal ways round; a packed east side pushes it west.
const zones = ["n", "e", "s", "w"].map((id) => ({ id, name: id, x: 0, y: 0, popularity: 0.5 }));
const catalog = {
  meta: {},
  site: { name: "t", walking_speed_m_per_min: 50, min_walk_min: 1, opening: { from: 1020, to: 1440 }, crowd_threshold: 0.75, base_crowd_curve: {} },
  zones,
  activities: [],
  routeGraph: {
    nodes: nodes.map((node) => ({ id: node.key, label: node.key, type: node.type, x: node.x, y: node.y, status: "open", zone: node.key.startsWith("zone-") ? node.key.slice(5) : undefined })),
    edges: edges.map((edge) => ({ from: edge.from, to: edge.to, walkMin: edge.walkMin, distanceM: edge.distanceM, status: "open", accessible: true })),
  },
} as unknown as Catalog;
const site = new Site(catalog);
const plain = site.pathBetweenNodes("zone-n", "zone-s");
assert.equal(plain?.minutes, 6);
const avoidEast = site.pathBetweenNodes("zone-n", "zone-s", { zonePenalty: (zone) => (zone === "e" ? 1.5 : 0) });
assert.deepEqual(avoidEast?.nodeIds, ["zone-n", "zone-w", "zone-s"], "detours around the crowded zone");
assert.equal(avoidEast?.minutes, 6, "reported minutes are real walking minutes, not penalised cost");
const avoidWest = site.pathBetweenNodes("zone-n", "zone-s", { zonePenalty: (zone) => (zone === "w" ? 1.5 : 0) });
assert.deepEqual(avoidWest?.nodeIds, ["zone-n", "zone-e", "zone-s"]);

// Accessible routing (audit 3.5): with steps on the east side, a wheelchair goes west even if longer.
const stepped = new Site({
  ...catalog,
  routeGraph: {
    nodes: catalog.routeGraph!.nodes.map((node) => ({ ...node, accessible: true })),
    edges: catalog.routeGraph!.edges.map((edge) => ({ ...edge, walkMin: edge.from === "zone-w" || edge.to === "zone-w" ? edge.walkMin + 2 : edge.walkMin, accessible: !(edge.from === "zone-e" || edge.to === "zone-e") })),
  },
} as unknown as Catalog);
assert.deepEqual(stepped.pathBetweenNodes("zone-n", "zone-s")?.nodeIds, ["zone-n", "zone-e", "zone-s"], "on foot, the short way");
assert.deepEqual(stepped.pathBetweenNodes("zone-n", "zone-s", { accessibleOnly: true })?.nodeIds, ["zone-n", "zone-w", "zone-s"], "step-free, the long way round");
assert.equal(stepped.pathBetweenNodes("zone-n", "zone-e", { accessibleOnly: true }), null, "no step-free way in: no route, never a guess");

console.log("walkway graph + crowd-aware routing: all assertions passed");
