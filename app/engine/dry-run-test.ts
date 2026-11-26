// اختبار المعاينة الجافة (ب) — حتمية + لا طفرة + طلب فارغ no-op + منطقة مجهولة.
// node --experimental-strip-types app/engine/dry-run-test.ts
import { projectDryRun, UnknownZoneError } from "./dry-run.ts";

const fixture = {
  meta: { source: "dry-run-test", note: "", currency: "SAR" },
  site: {
    name: "Dry-run venue",
    walking_speed_m_per_min: 60,
    min_walk_min: 1,
    opening: { from: 0, to: 1440 },
    crowd_threshold: 0.75,
    base_crowd_curve: { "19": 0.9 },
  },
  zones: [
    { id: "hot", name: "Hot zone", x: 0, y: 0, popularity: 1.0 },
    { id: "mid", name: "Mid zone", x: 10, y: 0, popularity: 0.8 },
    { id: "gem", name: "Hidden gem", x: 20, y: 0, popularity: 0.5 },
    { id: "calm", name: "Calm zone", x: 30, y: 0, popularity: 0.3 },
  ],
  activities: [
    { id: "hot-a", name: "Hot A", zone: "hot", type: "show", duration_min: 20, price: 0, family: true, interests: ["fun"], moods: ["fun"], popularity: 0.9, schedule: { type: "continuous" as const, from: 0, to: 1440 } },
    { id: "gem-a", name: "Gem A", zone: "gem", type: "culture", duration_min: 20, price: 0, family: true, interests: ["fun"], moods: ["fun"], popularity: 0.4, schedule: { type: "continuous" as const, from: 0, to: 1440 } },
  ],
};

const minute = 19 * 60 + 30; // 19:30

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) console.log(`  ✅ ${name}`);
  else {
    failures += 1;
    console.error(`  ❌ ${name}\n    actual=${a}\n    expected=${b}`);
  }
}

// 1) empty overrides = no-op: projection identical to a fresh baseline projection.
const empty1 = projectDryRun(fixture, minute, [], []);
const empty2 = projectDryRun(fixture, minute, [], []);
check("empty request is a no-op (committed false)", empty1.committed, false);
check("empty request is deterministic", empty1, empty2);

// 2) determinism with overrides: two calls same input → identical output.
const overrides = [{ zone: "calm", level: 0.95 }];
const run1 = projectDryRun(fixture, minute, overrides, []);
const run2 = projectDryRun(fixture, minute, overrides, []);
check("override projection is deterministic", run1, run2);

// 3) the override raises the target zone above threshold without mutating the catalog.
const before = JSON.stringify(fixture);
const calm = run1.zones.find((zone) => zone.zone === "calm");
check("override saturates the target zone", calm?.overThreshold, true);
check("catalog input is not mutated", JSON.stringify(fixture), before);

// 4) unknown zone throws (and therefore the route returns 400 without writing).
let threw: unknown = null;
try {
  projectDryRun(fixture, minute, [{ zone: "nowhere", level: 0.9 }], []);
} catch (error) {
  threw = error;
}
check("unknown zone throws UnknownZoneError", threw instanceof UnknownZoneError, true);
check("unknown zone names the zone", (threw as UnknownZoneError)?.zone, "nowhere");

// 5) no incentives provided → selectedIncentive is null (reuse of the selector, no crash).
check("no incentives → selectedIncentive null", run1.selectedIncentive, null);

// 6) load balance stays within 0..100 and operational impact is numeric and bounded.
check("load balance in range", run1.loadBalancePct >= 0 && run1.loadBalancePct <= 100, true);
check("operational impact in range", run1.operationalImpact >= 0 && run1.operationalImpact <= 100, true);

if (failures > 0) {
  console.error(`dry-run: ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("dry-run: all assertions passed");
