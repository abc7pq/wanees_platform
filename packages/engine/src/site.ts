// الموقع والكتالوج والزحام — الكتالوج يمرر من الخارج (يدعم إدارة الفعاليات وقت التشغيل)
import type { Catalog, Zone, Activity, Profile, CrowdEvent, Location, RouteGraphNode, RouteGraphEdge } from "./types.ts";
import { midPriceCap } from "./matching.ts";

export class Site {
  meta: Catalog["meta"];
  cfg: Catalog["site"];
  zones: Map<string, Zone>;
  activities: Map<string, Activity>;
  locations: Map<string, Location>;
  venueName: string;

  constructor(raw: Catalog) {
    this.meta = raw.meta;
    this.cfg = raw.site;
    this.venueName = raw.site.name;
    this.zones = new Map(raw.zones.map((z) => [z.id, z]));
    this.activities = new Map(raw.activities.map((a) => [a.id, a]));
    this.locations = new Map((raw.locations ?? []).map((location) => [location.id, location]));
    this.routeGraphNodes = new Map((raw.routeGraph?.nodes ?? []).map((node) => [node.id, node]));
    this.routeGraph = new Map<string, RouteGraphEdge[]>();
    for (const edge of raw.routeGraph?.edges ?? []) {
      const edges = this.routeGraph.get(edge.from) ?? [];
      edges.push(edge);
      this.routeGraph.set(edge.from, edges);
    }
    this.baseCurve = new Map(
      Object.entries(raw.site.base_crowd_curve).map(([h, v]) => [Number(h), v as number])
    );
    this.crowdThreshold = raw.site.crowd_threshold;
    this.crowdOverrides = new Map(); // "zone:hour" -> level
  }

  baseCurve: Map<number, number>;
  crowdThreshold: number;
  crowdOverrides: Map<string, number>;
  private measuredCrowd = new Map<string, number>();
  private midPrice: number | null | undefined;

  /** Price above which an activity counts as premium (70th percentile of known prices). */
  midPriceCap(): number | null {
    if (this.midPrice === undefined) this.midPrice = midPriceCap(this.activities.values());
    return this.midPrice;
  }
  routeGraphNodes: Map<string, RouteGraphNode>;
  routeGraph: Map<string, RouteGraphEdge[]>;

  resetEvents() {
    this.crowdOverrides.clear();
    this.measuredCrowd.clear();
  }

  travelMin(z1: string, z2: string): number {
    if (z1 === z2) return 0;
    const graphMinutes = this.shortestPathWalkMin(z1, z2);
    if (graphMinutes != null) return Math.max(this.cfg.min_walk_min, graphMinutes);
    const a = this.zones.get(z1);
    const b = this.zones.get(z2);
    if (!a || !b) return this.cfg.min_walk_min;
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const t = d / this.cfg.walking_speed_m_per_min;
    return Math.max(this.cfg.min_walk_min, Math.round(t));
  }

  shortestPathWalkMin(z1: string, z2: string): number | null {
    if (z1 === z2) return 0;
    const start = [...this.routeGraphNodes.values()].find((node) => node.zone === z1 && node.status === "open");
    const target = [...this.routeGraphNodes.values()].find((node) => node.zone === z2 && node.status === "open");
    if (!start || !target) return null;
    return this.dijkstra(start.id, target.id)?.minutes ?? null;
  }

  // أقصر مسار فعلي على رسم الموقع — يعيد تسلسل العقد مع الدقائق (أساس خطوات الاتجاهات)
  shortestPath(z1: string, z2: string): { minutes: number; nodeIds: string[] } | null {
    if (z1 === z2) return { minutes: 0, nodeIds: [] };
    const start = [...this.routeGraphNodes.values()].find((node) => node.zone === z1 && node.status === "open");
    const target = [...this.routeGraphNodes.values()].find((node) => node.zone === z2 && node.status === "open");
    if (!start || !target) return null;
    return this.dijkstra(start.id, target.id);
  }

  /**
   * Shortest walk between two graph nodes. With `zonePenalty`, edges entering a zone cost
   * walkMin × (1 + penalty(zone)) so the route can bend around crowded areas (like traffic-aware
   * driving directions); the returned `minutes` are always the real walking minutes of the chosen path.
   */
  pathBetweenNodes(
    startNodeId: string,
    targetNodeId: string,
    options: { zonePenalty?: (zoneId: string) => number } = {},
  ): { minutes: number; nodeIds: string[] } | null {
    const start = this.routeGraphNodes.get(startNodeId);
    const target = this.routeGraphNodes.get(targetNodeId);
    if (!start || !target || start.status !== "open" || target.status !== "open") return null;
    if (start.id === target.id) return { minutes: 0, nodeIds: [start.id] };
    const found = this.dijkstra(start.id, target.id, options.zonePenalty);
    if (!found || !options.zonePenalty) return found;
    let minutes = 0;
    for (let index = 1; index < found.nodeIds.length; index += 1) {
      minutes += this.walkMinBetweenNodes(found.nodeIds[index - 1], found.nodeIds[index]) ?? 0;
    }
    return { minutes, nodeIds: found.nodeIds };
  }

  walkMinBetweenNodes(fromNodeId: string, toNodeId: string): number | null {
    const edge = (this.routeGraph.get(fromNodeId) ?? []).find((candidate) => candidate.to === toNodeId && candidate.status === "open");
    return edge ? Math.max(0, edge.walkMin) : null;
  }

  private dijkstra(startId: string, targetId: string, zonePenalty?: (zoneId: string) => number): { minutes: number; nodeIds: string[] } | null {
    const distances = new Map<string, number>([[startId, 0]]);
    const previous = new Map<string, string>();
    const visited = new Set<string>();
    while (true) {
      let currentId: string | undefined;
      let currentDistance = Number.POSITIVE_INFINITY;
      for (const [nodeId, distance] of distances) {
        if (!visited.has(nodeId) && distance < currentDistance) {
          currentId = nodeId;
          currentDistance = distance;
        }
      }
      if (!currentId) return null;
      if (currentId === targetId) {
        const path = [targetId];
        while (previous.has(path[0])) path.unshift(previous.get(path[0])!);
        return { minutes: currentDistance, nodeIds: path };
      }
      visited.add(currentId);
      for (const edge of this.routeGraph.get(currentId) ?? []) {
        if (edge.status !== "open" || !this.routeGraphNodes.get(edge.to) || this.routeGraphNodes.get(edge.to)?.status !== "open") continue;
        const toZone = this.routeGraphNodes.get(edge.to)?.zone;
        const penalty = zonePenalty && toZone ? Math.max(0, zonePenalty(toZone)) : 0;
        const next = currentDistance + Math.max(0, edge.walkMin) * (1 + penalty);
        if (next < (distances.get(edge.to) ?? Number.POSITIVE_INFINITY)) {
          distances.set(edge.to, next);
          previous.set(edge.to, currentId);
        }
      }
    }
  }

  findLocation(query: string): Location | null {
    const normalize = (value: string) => value
      .toLocaleLowerCase("ar-SA")
      .normalize("NFKD")
      .replace(/[\u064B-\u065F\u0670]/g, "")
      .replace(/[إأآٱ]/g, "ا")
      .replace(/ى/g, "ي")
      .replace(/ة/g, "ه")
      .replace(/[،,؛;.!؟?]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const value = normalize(query);
    if (!value) return null;
    const queryTokens = value.split(" ").filter((token) => token.length > 1);
    let best: { location: Location; score: number } | null = null;
    for (const location of this.locations.values()) {
      const labels = [location.label, ...location.aliases, location.type].map(normalize);
      let score = 0;
      for (const label of labels) {
        if (!label) continue;
        if (label === value) score = Math.max(score, 100);
        else if (value.includes(label) || label.includes(value)) score = Math.max(score, 70);
        const labelTokens = new Set(label.split(" "));
        score = Math.max(score, queryTokens.filter((token) => labelTokens.has(token)).length * 20);
      }
      if (location.status !== "open") score -= 15;
      if (score > (best?.score ?? 0)) best = { location, score };
    }
    return best && best.score >= 20 ? best.location : null;
  }

  crowd(zoneId: string, minute: number): number {
    const hour = Math.floor(minute / 60);
    const measured = this.measuredCrowd.get(`${zoneId}:${hour}`);
    if (measured !== undefined) return measured;
    const base = this.baseCurve.get(hour) ?? 0.25;
    const pop = this.zones.get(zoneId)!.popularity;
    let level = base * (0.6 + 0.4 * pop);
    const ov = this.crowdOverrides.get(`${zoneId}:${hour}`);
    if (ov !== undefined) level = Math.max(level, ov);
    return Math.min(1, level);
  }

  /** عامل موازنة الحمل: 0 تحت عتبة التشبع، يتصاعد فوقها */
  zoneLoadFactor(zoneId: string, minute: number): number {
    const c = this.crowd(zoneId, minute);
    if (c <= this.crowdThreshold) return 0;
    return (c - this.crowdThreshold) / (1 - this.crowdThreshold);
  }

  applyEvents(events: CrowdEvent[], nowMin: number): string[] {
    const notes: string[] = [];
    for (const ev of events) {
      if (ev.type === "crowd_spike") {
        const zone = this.zones.get(ev.zone);
        if (!zone) continue;
        const until = ev.until_hour ?? Math.floor(nowMin / 60) + 1;
        for (let h = Math.floor(nowMin / 60); h <= until; h++) {
          (ev.measured ? this.measuredCrowd : this.crowdOverrides).set(`${ev.zone}:${h}`, ev.level ?? 0.9);
        }
        notes.push(
          `لاحظنا ازدحامًا مرتفعًا في ${zone.name}.`
        );
      }
    }
    return notes;
  }
}

export function defaultProfile(): Profile {
  return {
    mood: undefined,
    budget: null,
    companions_kids: false,
    companions_adults: 1,
    interests: [],
    start_min: 1080,
    duration_min: 180,
    start_zone: "",
    must_include: [],
    avoid: [],
  };
}
