// Crowd Theater: a deterministic, agent-based "with vs without WANEES" simulation.
//
// The same visitors (same arrival times, same tastes, same random streams) live through the
// same night twice. The only difference between the two worlds is that, in the second one, a
// share of visitors (`adoptionPct`) use WANEES:
//   - they see live queue estimates when choosing their next zone, and
//   - when the operator publishes a show delay, those gathered for the show get a proposal:
//     a nearby filler chosen by the real coordinator (`diversionTargets`), then back in time
//     for the show. Some accept (`acceptPct`); the rest keep waiting.
// Everyone else behaves exactly like the visitors in the "without" world. With adoption at 0
// the two worlds are identical, minute by minute, which the tests assert.
//
// This is a visualisation of a model, not a forecast. Zone throughput is calibrated from the
// number of catalog activities per zone; no real queue or turnstile data is used.

import { Site } from "./site.ts";
import { diversionTargets } from "./coordinator.ts";
import type { CrowdDataSource, ZoneCrowdSnapshot } from "./crowd-source.ts";
import { mulberry32 } from "./crowd-source.ts";
import type { Catalog } from "./types.ts";

export const THEATER_STATE = { notArrived: 0, walking: 1, queueing: 2, enjoying: 3, left: 4, waitingShow: 5 } as const;

export interface TheaterShow {
  zone: string;
  /** Minute the show is scheduled to start. */
  startMin: number;
  durationMin: number;
  /** Share of visitors who want to see it, 0..100. */
  audiencePct: number;
}

export interface TheaterDelay {
  /** Minute the operator publishes the delay (must be before the show starts to matter). */
  atMin: number;
  durationMin: number;
}

export interface TheaterOptions {
  seed: number;
  visitors: number;
  arrivalWindowMin: number;
  horizonMin: number;
  /** Share of visitors who use WANEES in the "with" world, 0..100. */
  adoptionPct: number;
  /** Share of WANEES proposals that visitors accept, 0..100. */
  acceptPct: number;
  show?: TheaterShow | null;
  delay?: TheaterDelay | null;
  /** Where visitors enter and leave, in venue units. Defaults to just below the zones. */
  entrance?: { x: number; y: number };
  /** Venue units to metres. */
  metresPerUnit?: number;
}

export interface TheaterZone {
  id: string;
  name: string;
  x: number;
  y: number;
  popularity: number;
  /** Visitors admitted per minute. */
  admitsPerMin: number;
  hiddenGem: boolean;
}

export interface TheaterMetrics {
  /** Visitors who entered the venue during the horizon. */
  visitors: number;
  /** Zone visits and show seats that actually started (fun delivered). */
  visits: number;
  /** Average minutes standing in a queue or waiting for the show, per visit. */
  avgWaitMin: number;
  /** Share of visitors who stood 20 minutes or more in one place, 0..100. */
  longWaitPct: number;
  /** Most people standing and waiting for the show at once. */
  peakShowCrowd: number;
  /** Average minutes the show audience stood waiting before it started. */
  showWaitMin: number;
  showAttendance: number;
  /** Sum over minutes of people standing in a queue or waiting for the show. */
  standingMinutes: number;
  /** Share of visits that went to hidden gems (popularity ≤ 0.7), 0..100. */
  gemVisitsPct: number;
  /** WANEES users told the new show time before they had to stand and wait. */
  notified: number;
  proposalsSent: number;
  proposalsAccepted: number;
}

export interface TheaterWorld {
  /** Interleaved x,y per visitor per minute: index = (minute * visitors + i) * 2. */
  positions: Float32Array;
  /** THEATER_STATE per visitor per minute: index = minute * visitors + i. */
  states: Uint8Array;
  /** Queue length per zone per minute (show crowd included): index = minute * zones + z. */
  queues: Uint16Array;
  /** People standing in a queue or waiting for the show, per minute. */
  standingSeries: number[];
  /** People waiting for the show, per minute. */
  showCrowdSeries: number[];
  metrics: TheaterMetrics;
}

export interface TheaterRun {
  options: {
    seed: number;
    visitors: number;
    arrivalWindowMin: number;
    horizonMin: number;
    adoptionPct: number;
    acceptPct: number;
    show: TheaterShow | null;
    delay: TheaterDelay | null;
    entrance: { x: number; y: number };
    metresPerUnit: number;
  };
  zones: TheaterZone[];
  /** Minute the show actually starts (after any delay), or null without a show. */
  showActualStart: number | null;
  without: TheaterWorld;
  with: TheaterWorld;
}

export const THEATER_DEFAULTS: TheaterOptions = {
  seed: 20261128,
  visitors: 600,
  arrivalWindowMin: 60,
  horizonMin: 180,
  adoptionPct: 40,
  acceptPct: 60,
  show: null,
  delay: null,
};

const WALK_SPEED_M_PER_MIN = 65;
const DETOUR = 1.2;
const BALK_WAIT_MIN = 25;
const LONG_WAIT_MIN = 20;
/** Show-goers head for the show when it is this close. */
const SHOW_LEAD_MIN = 25;
/** Arriving later than this after the start means the show is missed. */
const SHOW_LATE_MIN = 5;
const ZONE_RADIUS = 26;

type Visitor = {
  id: number;
  rand: () => number;
  adopter: boolean;
  wantsShow: boolean;
  /** Show start this visitor believes: the original time unless WANEES told them otherwise. */
  believedShowStart: number;
  showDone: boolean;
  arriveAt: number;
  visitsWanted: number;
  visited: Set<number>;
  state: number;
  zone: number; // current or target zone, -1 = entrance
  forShow: boolean; // walking to the show
  fromX: number;
  fromY: number;
  walkStart: number;
  walkEnd: number;
  leaving: boolean;
  standingSince: number;
  enjoyUntil: number;
  waitedLong: boolean;
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function clampPct(value: number) {
  return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
}

/** Zones from a catalog, with throughput calibrated so the venue as a whole is not overloaded. */
export function theaterZones(catalog: Catalog, options: Pick<TheaterOptions, "visitors">): TheaterZone[] {
  const activityCount = new Map<string, number>();
  for (const activity of catalog.activities) activityCount.set(activity.zone, (activityCount.get(activity.zone) ?? 0) + 1);
  const weights = catalog.zones.map((zone) => 1 + (activityCount.get(zone.id) ?? 0));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0) || 1;
  // Demand is about five visits per visitor over 150 minutes; capacity is 1.5× that average,
  // so queues come from where people go, not from the venue being too small.
  const totalAdmits = ((options.visitors * 5) / 150) * 1.5;
  return catalog.zones.map((zone, index) => ({
    id: zone.id,
    name: zone.name,
    x: zone.x,
    y: zone.y,
    popularity: zone.popularity,
    admitsPerMin: round2(Math.max(0.6, (totalAdmits * weights[index]) / totalWeight)),
    hiddenGem: zone.popularity <= 0.7,
  }));
}

/** The most popular show in the catalog (zone, name), used as the default delayed show. */
export function headlineShow(catalog: Catalog): { zone: string; activityId: string; name: string } | null {
  const show = [...catalog.activities]
    .filter((activity) => activity.type === "show" && catalog.zones.some((zone) => zone.id === activity.zone))
    .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0) || a.id.localeCompare(b.id))[0];
  return show ? { zone: show.zone, activityId: show.id, name: show.name } : null;
}

function defaultEntrance(zones: TheaterZone[]) {
  const xs = zones.map((zone) => zone.x);
  const ys = zones.map((zone) => zone.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: Math.max(...ys) + 90 };
}

function resolveOptions(catalog: Catalog, input: Partial<TheaterOptions>): { zones: TheaterZone[]; options: TheaterRun["options"] } {
  const merged = { ...THEATER_DEFAULTS, ...input };
  const zones = theaterZones(catalog, merged);
  const show = merged.show && zones.some((zone) => zone.id === merged.show!.zone)
    ? { ...merged.show, audiencePct: clampPct(merged.show.audiencePct), durationMin: Math.max(1, Math.round(merged.show.durationMin)) }
    : null;
  // A delay only exists for a show, and only if it is published before the show starts.
  const delay = show && merged.delay && merged.delay.atMin < show.startMin && merged.delay.durationMin > 0 ? merged.delay : null;
  const options: TheaterRun["options"] = {
    seed: merged.seed,
    visitors: Math.max(1, Math.round(merged.visitors)),
    arrivalWindowMin: Math.max(1, Math.round(merged.arrivalWindowMin)),
    horizonMin: Math.max(1, Math.round(merged.horizonMin)),
    adoptionPct: clampPct(merged.adoptionPct),
    acceptPct: clampPct(merged.acceptPct),
    show,
    delay,
    entrance: merged.entrance ?? defaultEntrance(zones),
    metresPerUnit: merged.metresPerUnit ?? 0.62,
  };
  return { zones, options };
}

export function runCrowdTheater(catalog: Catalog, input: Partial<TheaterOptions> = {}): TheaterRun {
  const { zones, options } = resolveOptions(catalog, input);
  const show = options.show;
  const delay = options.delay;
  return {
    options,
    zones,
    showActualStart: show ? show.startMin + (delay?.durationMin ?? 0) : null,
    without: simulateWorld(catalog, zones, options, false),
    with: simulateWorld(catalog, zones, options, true),
  };
}

class QueueCrowd implements CrowdDataSource {
  readonly kind = "crowd_theater";
  private readonly zones: TheaterZone[];
  private readonly waitOf: (zone: number) => number;
  constructor(zones: TheaterZone[], waitOf: (zone: number) => number) {
    this.zones = zones;
    this.waitOf = waitOf;
  }
  readZones(atMinute: number): ZoneCrowdSnapshot[] {
    return this.zones.map((zone, index) => ({
      zone: zone.id,
      crowd: Math.min(1, this.waitOf(index) / 30),
      updatedAtMinute: atMinute,
    }));
  }
}

/** Totals-only runs (the adoption curve) skip the per-minute frames. */
function simulateWorld(catalog: Catalog, zones: TheaterZone[], options: TheaterRun["options"], wanees: boolean, recordFrames = true): TheaterWorld {
  const n = options.visitors;
  const horizon = options.horizonMin;
  const zoneCount = zones.length;
  const entrance = options.entrance;
  const show = options.show;
  const delay = options.delay;
  const showZone = show ? zones.findIndex((zone) => zone.id === show.zone) : -1;
  const actualShowStart = show ? show.startMin + (delay?.durationMin ?? 0) : Infinity;
  const showEnd = show ? actualShowStart + show.durationMin : -Infinity;

  const frames = recordFrames ? horizon + 1 : 0;
  const positions = new Float32Array(frames * n * 2);
  const states = new Uint8Array(frames * n);
  const queueCounts = new Uint16Array(frames * zoneCount);
  const standingSeries: number[] = [];
  const showCrowdSeries: number[] = [];

  // Same visitors in both worlds: arrival, taste, adoption and random stream come from the seed.
  const master = mulberry32(options.seed);
  const visitors: Visitor[] = [];
  for (let i = 0; i < n; i += 1) {
    const arriveAt = Math.floor(master() * options.arrivalWindowMin);
    const visitsWanted = 4 + Math.floor(master() * 3);
    const adopterRoll = master() * 100;
    const showRoll = master() * 100;
    const visitorSeed = Math.floor(master() * 0xffffffff);
    visitors.push({
      id: i,
      rand: mulberry32(visitorSeed),
      adopter: wanees && adopterRoll < options.adoptionPct,
      wantsShow: Boolean(show) && showRoll < (show?.audiencePct ?? 0),
      believedShowStart: show?.startMin ?? Infinity,
      showDone: false,
      arriveAt,
      visitsWanted,
      visited: new Set(),
      state: THEATER_STATE.notArrived,
      zone: -1,
      forShow: false,
      fromX: entrance.x,
      fromY: entrance.y,
      walkStart: 0,
      walkEnd: 0,
      leaving: false,
      standingSince: 0,
      enjoyUntil: 0,
      waitedLong: false,
    });
  }

  const queues: number[][] = zones.map(() => []);
  const audience: number[] = [];
  const credit = zones.map(() => 0);
  const site = new Site({
    meta: { source: "crowd-theater", note: "", currency: "SAR" },
    site: { name: catalog.site.name, walking_speed_m_per_min: WALK_SPEED_M_PER_MIN, min_walk_min: 1, opening: { from: 0, to: 1440 }, crowd_threshold: 0.75, base_crowd_curve: {} },
    zones: zones.map((zone) => ({ id: zone.id, name: zone.name, x: zone.x, y: zone.y, popularity: zone.popularity })),
    activities: [],
  });

  let visits = 0;
  let waitSum = 0;
  let gemVisits = 0;
  let standingMinutes = 0;
  let peakShowCrowd = 0;
  let showWaitSum = 0;
  let showAttendance = 0;
  let notified = 0;
  let proposalsSent = 0;
  let proposalsAccepted = 0;

  /** Estimated wait for a zone: queue length over throughput, as anyone standing there would judge it. */
  const queueWait = (zone: number) => queues[zone].length / zones[zone].admitsPerMin;
  const crowdSource = new QueueCrowd(zones, queueWait);

  const walkMinutes = (from: { x: number; y: number }, to: { x: number; y: number }) =>
    Math.max(1, Math.ceil((Math.hypot(to.x - from.x, to.y - from.y) * options.metresPerUnit * DETOUR) / WALK_SPEED_M_PER_MIN));

  const zonePoint = (zone: number) => (zone >= 0 ? { x: zones[zone].x, y: zones[zone].y } : entrance);

  const startWalk = (v: Visitor, zone: number, minute: number, from: { x: number; y: number }, forShow = false) => {
    v.state = THEATER_STATE.walking;
    v.fromX = from.x;
    v.fromY = from.y;
    v.zone = zone;
    v.forShow = forShow;
    v.walkStart = minute;
    v.walkEnd = minute + walkMinutes(from, zonePoint(zone));
  };

  const showPending = (v: Visitor) => v.wantsShow && !v.showDone && showZone >= 0;

  /** Next move for a visitor: the show when it is close, otherwise a zone, otherwise home. */
  const goNext = (v: Visitor, minute: number, from: { x: number; y: number }) => {
    if (showPending(v) && minute >= v.believedShowStart - SHOW_LEAD_MIN) {
      startWalk(v, showZone, minute, from, true);
      return;
    }
    if (v.visited.size >= v.visitsWanted && !showPending(v)) {
      v.leaving = true;
      startWalk(v, -1, minute, from);
      return;
    }
    const weights: number[] = [];
    let total = 0;
    for (let z = 0; z < zoneCount; z += 1) {
      let w = 0;
      if (!v.visited.has(z)) {
        const distance = Math.hypot(zones[z].x - from.x, zones[z].y - from.y);
        w = zones[z].popularity ** 4 / (1 + distance / 250);
        if (v.adopter) w *= Math.max(0.02, 1 - Math.min(1, queueWait(z) / 30)) ** 3;
      }
      weights.push(w);
      total += w;
    }
    if (total <= 0) {
      if (showPending(v)) startWalk(v, showZone, minute, from, true);
      else {
        v.leaving = true;
        startWalk(v, -1, minute, from);
      }
      return;
    }
    let pick = v.rand() * total;
    let chosen = -1;
    for (let z = 0; z < zoneCount && chosen < 0; z += 1) {
      pick -= weights[z];
      if (pick <= 0 && weights[z] > 0) chosen = z;
    }
    if (chosen < 0) chosen = weights.findLastIndex((w) => w > 0);
    startWalk(v, chosen, minute, from);
  };

  /** A nearby filler from the coordinator's diversion targets that still leaves time for the show. */
  const fillerFor = (v: Visitor, minute: number, here: { x: number; y: number }, newStart: number): number => {
    let best = -1;
    let bestScore = -Infinity;
    for (const target of diversionTargets(site, minute, zoneCount, crowdSource)) {
      const index = zones.findIndex((zone) => zone.id === target.zone);
      if (index < 0 || index === showZone || v.visited.has(index)) continue;
      const there = zonePoint(index);
      const roundTrip = walkMinutes(here, there) + walkMinutes(there, zonePoint(showZone));
      if (minute + roundTrip + 10 > newStart) continue; // must leave at least 10 minutes there
      const score = target.score - roundTrip * 4;
      if (score > bestScore) {
        bestScore = score;
        best = index;
      }
    }
    return best;
  };

  /** Visitors with the show still ahead cut a visit short to make it in time. */
  const enjoyEnd = (v: Visitor, minute: number, zone: number, planned: number) => {
    if (!showPending(v)) return planned;
    const leaveBy = v.believedShowStart - walkMinutes(zonePoint(zone), zonePoint(showZone));
    return Math.max(minute + 1, Math.min(planned, leaveBy));
  };

  const recordWait = (v: Visitor, wait: number) => {
    waitSum += wait;
    if (wait >= LONG_WAIT_MIN) v.waitedLong = true;
  };

  for (let minute = 0; minute <= horizon; minute += 1) {
    // 1. The operator publishes the delay. In the WANEES world, users waiting for or walking to
    //    the show learn the new time and get a filler proposal; everyone else finds out at the show.
    if (wanees && delay && show && minute === delay.atMin) {
      const newStart = actualShowStart;
      for (const v of visitors) {
        if (!v.adopter || !showPending(v)) continue;
        v.believedShowStart = newStart;
        const gathered = v.state === THEATER_STATE.waitingShow;
        const heading = v.state === THEATER_STATE.walking && v.forShow;
        if (!gathered && !heading) {
          notified += 1;
          continue;
        }
        proposalsSent += 1;
        if (v.rand() * 100 >= options.acceptPct) continue;
        const here = gathered ? zonePoint(showZone) : interpolate(v, minute, zones, entrance);
        const filler = fillerFor(v, minute, here, newStart);
        if (filler < 0) continue;
        proposalsAccepted += 1;
        if (gathered) {
          audience.splice(audience.indexOf(v.id), 1);
          const stood = minute - v.standingSince;
          showWaitSum += stood;
          recordWait(v, stood);
        }
        startWalk(v, filler, minute, here);
      }
    }

    // 2. Arrivals, walking, and reaching a zone or the show.
    for (const v of visitors) {
      if (v.state === THEATER_STATE.notArrived && v.arriveAt === minute) goNext(v, minute, entrance);
      if (v.state !== THEATER_STATE.walking || minute < v.walkEnd) continue;
      if (v.leaving) {
        v.state = THEATER_STATE.left;
        continue;
      }
      const zone = v.zone;
      const here = zonePoint(zone);
      if (v.forShow) {
        if (minute > actualShowStart + SHOW_LATE_MIN) {
          v.showDone = true; // missed it
          goNext(v, minute, here);
        } else if (minute >= actualShowStart) {
          v.showDone = true;
          showAttendance += 1;
          visits += 1;
          v.state = THEATER_STATE.enjoying;
          v.enjoyUntil = showEnd;
        } else {
          v.state = THEATER_STATE.waitingShow;
          v.standingSince = minute;
          audience.push(v.id);
        }
        continue;
      }
      // Everyone can see a long queue on arrival; half of them give up on it.
      if (queueWait(zone) > BALK_WAIT_MIN && v.rand() < 0.5) {
        v.visited.add(zone);
        goNext(v, minute, here);
        continue;
      }
      v.state = THEATER_STATE.queueing;
      v.standingSince = minute;
      queues[zone].push(v.id);
    }

    // 3. The show starts and seats its audience.
    if (show && minute === actualShowStart) {
      for (const id of audience) {
        const v = visitors[id];
        const stood = minute - v.standingSince;
        showWaitSum += stood;
        recordWait(v, stood);
        v.showDone = true;
        showAttendance += 1;
        visits += 1;
        v.state = THEATER_STATE.enjoying;
        v.enjoyUntil = showEnd;
      }
      audience.length = 0;
    }

    // 4a. Show-goers still standing in another queue step out when it is time to walk to the show.
    for (let z = 0; z < zoneCount; z += 1) {
      if (z === showZone || !queues[z].length) continue;
      const leaveBy = (v: Visitor) => v.believedShowStart - walkMinutes(zonePoint(z), zonePoint(showZone));
      const stepping = queues[z].filter((id) => showPending(visitors[id]) && minute >= leaveBy(visitors[id]));
      if (!stepping.length) continue;
      queues[z] = queues[z].filter((id) => !stepping.includes(id));
      for (const id of stepping) {
        const v = visitors[id];
        recordWait(v, minute - v.standingSince);
        startWalk(v, showZone, minute, zonePoint(z), true);
      }
    }

    // 4b. Zones admit people from the head of their queue.
    for (let z = 0; z < zoneCount; z += 1) {
      credit[z] += zones[z].admitsPerMin;
      while (credit[z] >= 1 && queues[z].length) {
        credit[z] -= 1;
        const v = visitors[queues[z].shift()!];
        recordWait(v, minute - v.standingSince);
        visits += 1;
        if (zones[z].hiddenGem) gemVisits += 1;
        v.visited.add(z);
        v.state = THEATER_STATE.enjoying;
        v.enjoyUntil = enjoyEnd(v, minute, z, minute + 15 + Math.floor(v.rand() * 16));
      }
      if (!queues[z].length) credit[z] = Math.min(credit[z], 1);
    }

    // 5. Finished visits pick their next move.
    for (const v of visitors) {
      if (v.state === THEATER_STATE.enjoying && minute >= v.enjoyUntil) goNext(v, minute, zonePoint(v.zone));
    }

    // 6. Record the frame.
    let standing = audience.length;
    for (let z = 0; z < zoneCount; z += 1) standing += queues[z].length;
    peakShowCrowd = Math.max(peakShowCrowd, audience.length);
    standingMinutes += standing;
    standingSeries.push(standing);
    showCrowdSeries.push(audience.length);
    if (!recordFrames) continue;
    for (let z = 0; z < zoneCount; z += 1) {
      queueCounts[minute * zoneCount + z] = queues[z].length + (z === showZone ? audience.length : 0);
      queues[z].forEach((id, position) => writePosition(positions, minute, n, id, queueSpot(zones[z], position, z, 0)));
    }
    audience.forEach((id, position) => writePosition(positions, minute, n, id, queueSpot(zones[showZone], position, showZone, 1)));
    for (const v of visitors) {
      states[minute * n + v.id] = v.state;
      if (v.state === THEATER_STATE.queueing || v.state === THEATER_STATE.waitingShow) continue;
      const p = v.state === THEATER_STATE.walking
        ? interpolate(v, minute, zones, entrance)
        : v.state === THEATER_STATE.enjoying
          ? enjoySpot(zones[v.zone], v.id)
          : v.state === THEATER_STATE.left || v.state === THEATER_STATE.notArrived
            ? entrance
            : zonePoint(v.zone);
      writePosition(positions, minute, n, v.id, p);
    }
  }

  const arrived = visitors.filter((v) => v.arriveAt <= horizon);
  return {
    positions,
    states,
    queues: queueCounts,
    standingSeries,
    showCrowdSeries,
    metrics: {
      visitors: arrived.length,
      visits,
      avgWaitMin: visits ? round2(waitSum / visits) : 0,
      longWaitPct: arrived.length ? round2((arrived.filter((v) => v.waitedLong).length / arrived.length) * 100) : 0,
      peakShowCrowd,
      showWaitMin: showAttendance ? round2(showWaitSum / showAttendance) : 0,
      showAttendance,
      standingMinutes,
      gemVisitsPct: visits ? round2((gemVisits / visits) * 100) : 0,
      notified,
      proposalsSent,
      proposalsAccepted,
    },
  };
}

function writePosition(positions: Float32Array, minute: number, n: number, id: number, p: { x: number; y: number }) {
  positions[(minute * n + id) * 2] = p.x;
  positions[(minute * n + id) * 2 + 1] = p.y;
}

function interpolate(v: Visitor, minute: number, zones: TheaterZone[], entrance: { x: number; y: number }) {
  const target = v.zone >= 0 ? zones[v.zone] : entrance;
  const span = Math.max(1, v.walkEnd - v.walkStart);
  const t = Math.min(1, Math.max(0, (minute - v.walkStart) / span));
  return { x: v.fromX + (target.x - v.fromX) * t, y: v.fromY + (target.y - v.fromY) * t };
}

/** Queue spots spiral outwards from the zone edge, so a long queue is visibly long. */
function queueSpot(zone: TheaterZone, position: number, zoneIndex: number, lane: number) {
  const perRing = 22;
  const ring = Math.floor(position / perRing);
  const radius = ZONE_RADIUS + 8 + lane * 4 + ring * 7;
  const angle = zoneIndex * 1.7 + lane * 0.15 + (position % perRing) * ((Math.PI * 2) / perRing) + ring * 0.14;
  return { x: zone.x + Math.cos(angle) * radius, y: zone.y + Math.sin(angle) * radius };
}

/** Visitors enjoying a zone sit inside its circle at a stable, spread-out spot. */
function enjoySpot(zone: TheaterZone, id: number) {
  const angle = id * 2.399963; // golden angle
  const radius = ZONE_RADIUS * 0.85 * Math.sqrt(((id * 37) % 100) / 100);
  return { x: zone.x + Math.cos(angle) * radius, y: zone.y + Math.sin(angle) * radius };
}

export interface AdoptionPoint {
  adoptionPct: number;
  metrics: TheaterMetrics;
}

export interface AdoptionCurve {
  /** The "without WANEES" world: identical for every adoption level. */
  baseline: TheaterMetrics;
  points: AdoptionPoint[];
}

/**
 * The same night at several adoption levels (totals only, no frames). Every point uses the same
 * visitors and the same seed, so the curve isolates the effect of adoption.
 */
export function adoptionCurve(
  catalog: Catalog,
  input: Partial<TheaterOptions> = {},
  levels: readonly number[] = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
): AdoptionCurve {
  const { zones, options } = resolveOptions(catalog, input);
  const baseline = simulateWorld(catalog, zones, options, false, false).metrics;
  const points = [...new Set(levels.map(clampPct))]
    .sort((a, b) => a - b)
    .map((adoptionPct) => ({
      adoptionPct,
      metrics: simulateWorld(catalog, zones, { ...options, adoptionPct }, true, false).metrics,
    }));
  return { baseline, points };
}

/** Least-squares slope of a metric per +10 points of adoption (negative = it goes down). */
export function slopePerTenPoints(points: readonly AdoptionPoint[], metric: (m: TheaterMetrics) => number): number {
  if (points.length < 2) return 0;
  const xs = points.map((p) => p.adoptionPct / 10);
  const ys = points.map((p) => metric(p.metrics));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i += 1) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den ? round2(num / den) : 0;
}

/** Shows an operator can delay, most popular first. */
export function catalogShows(catalog: Catalog): { activityId: string; zone: string; name: string }[] {
  return [...catalog.activities]
    .filter((activity) => activity.type === "show" && catalog.zones.some((zone) => zone.id === activity.zone))
    .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0) || a.id.localeCompare(b.id))
    .map((activity) => ({ activityId: activity.id, zone: activity.zone, name: activity.name }));
}
