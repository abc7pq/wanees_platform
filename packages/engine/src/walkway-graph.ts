// Deterministic walkway graph for a lagoon-style venue.
// Zones connect to their natural neighbours (Gabriel graph: no other zone sits inside the circle
// whose diameter is the pair), so paths are short and local. With a water `obstacle`, any link
// that would cross the water is dropped, except bridges from zones that stand in the water
// (island, pier) to their two nearest shore zones. If the result is disconnected, ring links by
// bearing around the centre that stay on land are added until it is connected. Service and gate
// nodes attach to their nearest zones. Distances are metres (units × metresPerUnit × detour).
import { pointInPolygon, type GeoPoint } from "./venue-geometry.ts";

export type WalkwayNode = { key: string; type: string; x: number; y: number };
export type WalkwayEdge = { from: string; to: string; distanceM: number; walkMin: number };

export type WalkwayOptions = {
  center: { x: number; y: number };
  metresPerUnit: number;
  walkingSpeedMPerMin: number;
  /** Paths are never perfectly straight; multiply the straight-line distance by this factor. */
  detourFactor?: number;
  /** How many nearby zones a service/gate node links to. */
  attachCount?: number;
  /** Water or other area walkways may not cross. */
  obstacle?: readonly GeoPoint[];
};

function crossesObstacle(a: WalkwayNode, b: WalkwayNode, obstacle: readonly GeoPoint[] | undefined) {
  if (!obstacle) return false;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(2, Math.ceil(length / 8));
  // Ignore the first/last 20 units so zones standing right on the shore can still connect.
  const margin = Math.min(0.45, 20 / Math.max(length, 1));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    if (t < margin || t > 1 - margin) continue;
    if (pointInPolygon(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, obstacle)) return true;
  }
  return false;
}

export function buildWalkwayEdges(nodes: readonly WalkwayNode[], options: WalkwayOptions): WalkwayEdge[] {
  const detour = options.detourFactor ?? 1.2;
  const attachCount = options.attachCount ?? 2;
  const zones = [...nodes.filter((node) => node.type === "ZONE")].sort((a, b) => a.key.localeCompare(b.key));
  const others = nodes.filter((node) => node.type !== "ZONE");
  const distance = (a: WalkwayNode, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  const inWater = (node: WalkwayNode) => Boolean(options.obstacle && pointInPolygon(node.x, node.y, options.obstacle));

  const pairs = new Map<string, [WalkwayNode, WalkwayNode]>();
  const link = (a: WalkwayNode, b: WalkwayNode) => {
    if (a.key === b.key) return;
    const id = [a.key, b.key].sort().join("|");
    if (!pairs.has(id)) pairs.set(id, a.key < b.key ? [a, b] : [b, a]);
  };

  // 1) Natural neighbours on land.
  for (let i = 0; i < zones.length; i += 1) {
    for (let j = i + 1; j < zones.length; j += 1) {
      const a = zones[i];
      const b = zones[j];
      if (inWater(a) || inWater(b)) continue;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const radius = distance(a, b) / 2;
      const blocked = zones.some((other) => other !== a && other !== b && distance(other, mid) < radius - 1e-9);
      if (!blocked && !crossesObstacle(a, b, options.obstacle)) link(a, b);
    }
  }
  // 2) Bridges for zones standing in the water (island, pier head).
  for (const zone of zones.filter(inWater)) {
    const shore = zones
      .filter((other) => other !== zone && !inWater(other))
      .sort((a, b) => distance(zone, a) - distance(zone, b) || a.key.localeCompare(b.key))
      .slice(0, 2);
    for (const other of shore) link(zone, other);
  }
  // 3) Connectivity safety net: ring links by bearing (land first, then any).
  const bearing = (node: WalkwayNode) => Math.atan2(node.y - options.center.y, node.x - options.center.x);
  const ring = [...zones].filter((zone) => !inWater(zone)).sort((a, b) => bearing(a) - bearing(b) || a.key.localeCompare(b.key));
  const components = () => {
    const parent = new Map(zones.map((zone) => [zone.key, zone.key]));
    const find = (key: string): string => (parent.get(key) === key ? key : find(parent.get(key)!));
    for (const [a, b] of pairs.values()) parent.set(find(a.key), find(b.key));
    return new Set(zones.map((zone) => find(zone.key))).size;
  };
  for (const allowWater of [false, true]) {
    for (let index = 0; index < ring.length && components() > 1; index += 1) {
      const a = ring[index];
      const b = ring[(index + 1) % ring.length];
      if (allowWater || !crossesObstacle(a, b, options.obstacle)) link(a, b);
    }
  }

  // Gates and services attach to their nearest zones.
  for (const node of others) {
    const nearest = [...zones]
      .sort((a, b) => distance(a, node) - distance(b, node) || a.key.localeCompare(b.key))
      .slice(0, attachCount);
    for (const zone of nearest) link(node, zone);
  }

  const edges: WalkwayEdge[] = [];
  for (const [a, b] of [...pairs.values()].sort((left, right) => `${left[0].key}|${left[1].key}`.localeCompare(`${right[0].key}|${right[1].key}`))) {
    const distanceM = Math.max(20, Math.round(distance(a, b) * options.metresPerUnit * detour));
    const walkMin = Math.max(1, Math.ceil(distanceM / options.walkingSpeedMPerMin));
    edges.push({ from: a.key, to: b.key, distanceM, walkMin }, { from: b.key, to: a.key, distanceM, walkMin });
  }
  return edges;
}

/** Nearest node by straight-line distance (stable on ties). */
export function nearestNodeKey(nodes: readonly WalkwayNode[], point: { x: number; y: number }): string | null {
  let best: WalkwayNode | null = null;
  let bestDistance = Infinity;
  for (const node of nodes) {
    const distance = Math.hypot(node.x - point.x, node.y - point.y);
    if (distance < bestDistance || (distance === bestDistance && best && node.key < best.key)) {
      best = node;
      bestDistance = distance;
    }
  }
  return best?.key ?? null;
}
