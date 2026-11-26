// Crowd Theater tests: determinism, a fair counterfactual, and the show-delay story.
// node --experimental-strip-types packages/engine/src/theater-test.ts
import { runCrowdTheater, headlineShow, THEATER_STATE, adoptionCurve, slopePerTenPoints, catalogShows } from "./theater.ts";
import type { TheaterMetrics, TheaterOptions } from "./theater.ts";
import type { Catalog } from "./types.ts";
import { catalogData } from "../../../app/data/catalog.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failures++;
    console.error(`  ❌ ${name} ${detail}`);
  }
}

// A small fixed venue so the assertions don't move when the published catalog changes.
const zoneSpecs = [
  ["lagoon", 0.9, 0, 0, 4],
  ["arena", 0.9, 200, -150, 3],
  ["market", 0.85, -200, -150, 3],
  ["garden", 0.65, 250, 150, 1],
  ["museum", 0.6, -250, 150, 1],
  ["pier", 0.7, 0, 300, 2],
  ["forest", 0.55, 0, -320, 1],
  ["arcade", 0.8, 380, -20, 2],
] as const;
const fixture = {
  meta: { source: "theater-test", note: "", currency: "SAR" },
  site: { name: "Theater venue", walking_speed_m_per_min: 65, min_walk_min: 1, opening: { from: 17, to: 24 }, crowd_threshold: 0.75, base_crowd_curve: {} },
  zones: zoneSpecs.map(([id, popularity, x, y]) => ({ id, name: id, x, y, popularity })),
  activities: [
    ...zoneSpecs.flatMap(([zone, , , , count]) =>
      Array.from({ length: count }, (_, i) => ({ id: `${zone}-${i}`, name: `${zone} ${i}`, zone, type: "ride", popularity: 0.5 })),
    ),
    { id: "headline-show", name: "Headline show", zone: "arena", type: "show", popularity: 0.95 },
  ],
} as unknown as Catalog;

const show = { zone: "arena", startMin: 90, durationMin: 20, audiencePct: 30 };
const base: Partial<TheaterOptions> = { visitors: 400, show };
const delayed: Partial<TheaterOptions> = { ...base, delay: { atMin: 70, durationMin: 25 } };

console.log("\nDeterminism");
{
  const a = runCrowdTheater(fixture, delayed);
  const b = runCrowdTheater(fixture, delayed);
  check("same options give the same metrics", JSON.stringify(a.with.metrics) === JSON.stringify(b.with.metrics) && JSON.stringify(a.without.metrics) === JSON.stringify(b.without.metrics));
  check("same options give the same frames", a.with.positions.every((value, i) => value === b.with.positions[i]) && a.with.states.every((value, i) => value === b.with.states[i]));
  check("every recorded position is finite", a.with.positions.every(Number.isFinite) && a.without.positions.every(Number.isFinite));
  const validStates = new Set<number>(Object.values(THEATER_STATE));
  check("every recorded state is valid", a.with.states.every((s) => validStates.has(s)));
}

console.log("\nFair counterfactual");
{
  const run = runCrowdTheater(fixture, { ...delayed, adoptionPct: 0 });
  check("with 0% adoption the two worlds are identical (metrics)", JSON.stringify(run.with.metrics) === JSON.stringify(run.without.metrics));
  check("with 0% adoption the two worlds are identical (every frame)", run.with.states.every((s, i) => s === run.without.states[i]) && run.with.positions.every((p, i) => p === run.without.positions[i]));
  check("the 'without' world never sends proposals", run.without.metrics.proposalsSent === 0 && runCrowdTheater(fixture, delayed).without.metrics.proposalsSent === 0);
  const other = runCrowdTheater(fixture, { ...delayed, adoptionPct: 80 });
  const reference = runCrowdTheater(fixture, delayed);
  check("the 'without' world does not depend on adoption", JSON.stringify(other.without.metrics) === JSON.stringify(reference.without.metrics));
}

console.log("\nShow delay");
{
  const run = runCrowdTheater(fixture, { ...delayed, adoptionPct: 40, acceptPct: 60 });
  const { with: w, without: wo } = run;
  console.log(`     without: peak crowd ${wo.metrics.peakShowCrowd}, show wait ${wo.metrics.showWaitMin} min, attendance ${wo.metrics.showAttendance}`);
  console.log(`     with:    peak crowd ${w.metrics.peakShowCrowd}, show wait ${w.metrics.showWaitMin} min, attendance ${w.metrics.showAttendance}, notified ${w.metrics.notified}, accepted ${w.metrics.proposalsAccepted}/${w.metrics.proposalsSent}`);
  check("the show starts after the delay", run.showActualStart === 115);
  check("fewer people stand waiting for the delayed show", w.metrics.peakShowCrowd < wo.metrics.peakShowCrowd);
  check("show-goers wait less on average", w.metrics.showWaitMin < wo.metrics.showWaitMin);
  check("WANEES users still see the show", w.metrics.showAttendance >= wo.metrics.showAttendance * 0.95, `${w.metrics.showAttendance} vs ${wo.metrics.showAttendance}`);
  check("total standing time goes down", w.metrics.standingMinutes < wo.metrics.standingMinutes);
  check("no fewer visits overall", w.metrics.visits >= wo.metrics.visits * 0.98);
  check("users were told the new time", w.metrics.notified > 0);
  check("accepted proposals never exceed sent ones", w.metrics.proposalsAccepted <= w.metrics.proposalsSent);
  const noShowWait = runCrowdTheater(fixture, { ...base, adoptionPct: 40 });
  check("no delay means no proposals", noShowWait.with.metrics.proposalsSent === 0 && noShowWait.with.metrics.notified === 0);
}

console.log("\nGuards");
{
  const late = runCrowdTheater(fixture, { ...base, delay: { atMin: 95, durationMin: 25 } });
  check("a delay published after the show started is ignored", late.options.delay === null && late.showActualStart === 90);
  const noShow = runCrowdTheater(fixture, { visitors: 100, show: { ...show, zone: "nowhere" }, delay: { atMin: 10, durationMin: 25 } });
  check("an unknown show zone means no show and no delay", noShow.options.show === null && noShow.options.delay === null);
  const clamped = runCrowdTheater(fixture, { visitors: 50, adoptionPct: 250, acceptPct: -5 });
  check("percentages are clamped to 0..100", clamped.options.adoptionPct === 100 && clamped.options.acceptPct === 0);
}

console.log("\nAdoption curve");
{
  const curve = adoptionCurve(fixture, delayed, [0, 40, 100]);
  const framed = (adoptionPct: number) => runCrowdTheater(fixture, { ...delayed, adoptionPct });
  check("the baseline is the 'without' world", JSON.stringify(curve.baseline) === JSON.stringify(framed(40).without.metrics));
  check("0% adoption equals the baseline", JSON.stringify(curve.points[0].metrics) === JSON.stringify(curve.baseline));
  check("totals-only runs match the animated runs exactly", curve.points.every((point) => JSON.stringify(point.metrics) === JSON.stringify(framed(point.adoptionPct).with.metrics)));
  check("full adoption beats none for the delayed show", curve.points[2].metrics.showWaitMin < curve.points[0].metrics.showWaitMin);
  check("the show-wait slope is negative", slopePerTenPoints(curve.points, (m) => m.showWaitMin) < 0);
  const levels = adoptionCurve(fixture, { ...base, visitors: 100 }, [50, 0, 50, 250]).points.map((point) => point.adoptionPct);
  check("levels are clamped, de-duplicated and sorted", JSON.stringify(levels) === JSON.stringify([0, 50, 100]));
  const line = [0, 10, 20].map((adoptionPct) => ({ adoptionPct, metrics: { showWaitMin: 30 - adoptionPct * 0.5 } as unknown as TheaterMetrics }));
  check("slope per 10 points on a straight line", slopePerTenPoints(line, (m) => m.showWaitMin) === -5);
  check("a single point has no slope", slopePerTenPoints(line.slice(0, 1), (m) => m.showWaitMin) === 0);
  const shows = catalogShows({ ...fixture, activities: [...fixture.activities, { id: "lost-show", name: "x", zone: "nowhere", type: "show", popularity: 1 }] } as unknown as Catalog);
  check("shows list skips unknown zones and ranks by popularity", shows.length === 1 && shows[0].activityId === "headline-show");
}

console.log("\nPublished catalog smoke");
{
  const catalog = catalogData as unknown as Catalog;
  const headline = headlineShow(catalog);
  check("the catalog has a headline show", Boolean(headline));
  const started = Date.now();
  const run = runCrowdTheater(catalog, {
    show: headline ? { zone: headline.zone, startMin: 90, durationMin: 20, audiencePct: 30 } : null,
    delay: { atMin: 70, durationMin: 25 },
  });
  const elapsed = Date.now() - started;
  check("600 visitors × 2 worlds × 180 minutes runs in under a second", elapsed < 1000, `${elapsed} ms`);
  check("every visitor arrives", run.with.metrics.visitors === 600 && run.without.metrics.visitors === 600);
}

if (failures) {
  console.error(`\n${failures} theater check(s) failed`);
  process.exit(1);
}
console.log("\nAll theater checks passed");
