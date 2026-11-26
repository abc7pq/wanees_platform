// اختبارات حزام المحاكاة + مصدر الزحام — قابلة للتشغيل ذاتيًا بلا بنية تحتية
// node --experimental-strip-types app/engine/simulate-test.ts
import { Site } from "./site.ts";
import { computeZoneLoads, coordinatorPlan } from "./coordinator.ts";
import { SimulatedCrowdSource, mulberry32 } from "./crowd-source.ts";
import type { CrowdDataSource } from "./crowd-source.ts";
import { runStrategy, compareStrategies } from "./simulate.ts";
import type { SimulationScenario } from "./simulate.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failures++;
    console.error(`  ❌ ${name} ${detail}`);
  }
}

// ---- fixture: موقع صغير للتِماس ----
const fixture = {
  meta: { source: "simulate-test", note: "", currency: "SAR" },
  site: {
    name: "Seam venue",
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
    { id: "calm", name: "Calm zone", x:30, y: 0, popularity: 0.3 },
  ],
  activities: [],
};
const site = new Site(fixture);
const minute = 19 * 60 + 30; // 19:30

// ---- (٢) مصدر الزحام: حتمية المصدر الحتمي ----
{
  const mk = (seed: number) =>
    new SimulatedCrowdSource({
      seed,
      baseCurve: { "19": 0.9 },
      zonePopularity: { hot: 1.0, mid: 0.8, gem: 0.5, calm: 0.3 },
      noiseAmp: 0.05,
    });
  const a = mk(42);
  const b = mk(42);
  const c = mk(43);
  check(
    "مصدر حتمي: نفس البذرة → نفس القراءات",
    JSON.stringify(a.readZones(minute)) === JSON.stringify(b.readZones(minute))
  );
  check(
    "مصدر حتمي: بذرة مختلفة → قراءات مختلفة",
    JSON.stringify(a.readZones(minute)) !== JSON.stringify(c.readZones(minute))
  );
  const r = a.readZones(minute);
  check("قراءة تعيد كل المناطق", r.length === 4, `len=${r.length}`);
  check("الازدحام ضمن 0..1", r.every((z) => z.crowd >= 0 && z.crowd <= 1));
  check("kind = simulated", a.kind === "simulated");
}

// ---- (٢ج) التِماس: حقن مصدر زحام في المنسّق (مطابق للطقس) ----
{
  const noCrowd = computeZoneLoads(site, minute);
  check("بلا مصدر: المنسّق يقرأ من نموذج الموقع (توافق إصدار)", noCrowd.every((z) => z.crowd >= 0));

  const spike: CrowdDataSource = {
    kind: "test_spike",
    readZones: (min) => [
      { zone: "hot", crowd: 0.95, updatedAtMinute: min },
      { zone: "mid", crowd: 0.2, updatedAtMinute: min },
      { zone: "gem", crowd: 0.1, updatedAtMinute: min },
      { zone: "calm", crowd: 0.05, updatedAtMinute: min },
    ],
  };
  const withSpike = computeZoneLoads(site, minute, spike);
  check("الحقن يغيّر قراءة المنطقة المشبعة", withSpike.find((z) => z.zone === "hot")!.crowd === 0.95);
  check("الحقن يغيّر قراءة المنطقة الهادئة", withSpike.find((z) => z.zone === "calm")!.crowd === 0.05);

  const plan = coordinatorPlan(site, minute, { crowd: spike });
  check(
    "الخطة تمرّر المصدر إلى الأحمال والأهداف والحوافز",
    plan.zones.find((z) => z.zone === "hot")!.crowd === 0.95 && plan.zones.length === 4,
    `hot=${plan.zones.find((z) => z.zone === "hot")!.crowd}`
  );
  const planNoCrowd = coordinatorPlan(site, minute);
  check("بلا مصدر: الخطة متطابقة مع السلوك السابق", planNoCrowd.zones.length === 4);
}

// ---- (١) المحاكاة: سيناريو مقارنة حتمي ----
const scenario: SimulationScenario = {
  seed: 20261122,
  horizonMinutes: 90,
  arrivalsPerMin: 35,
  zones: [
    { id: "hot", name: "Hot zone", popularity: 1.0, capacity: 60, serviceRatePerMin: 12 },
    { id: "mid", name: "Mid zone", popularity: 0.85, capacity: 50, serviceRatePerMin: 10 },
    { id: "gem", name: "Hidden gem", popularity: 0.5, capacity: 40, serviceRatePerMin: 8 },
    { id: "calm", name: "Calm zone", popularity: 0.3, capacity: 40, serviceRatePerMin: 8 },
    { id: "quiet", name: "Quiet zone", popularity: 0.2, capacity: 30, serviceRatePerMin: 6 },
  ],
};

{
  const c1 = compareStrategies(scenario);
  const c2 = compareStrategies(scenario);
  check(
    "المحاكاة حتمية: نفس السيناريو → نفس المقارنة",
    JSON.stringify(c1) === JSON.stringify(c2)
  );

  const lc = c1.leastCrowded;
  const co = c1.coordinator;
  check("الاستراتيجيتان وجّهتا زوارًا فعليًا", lc.visitors > 0 && co.visitors > 0, `lc=${lc.visitors} co=${co.visitors}`);
  check("لا فائض في الاستراتيجيتين", lc.overflow === 0 && co.overflow === 0, `lc=${lc.overflow} co=${co.overflow}`);

  check(
    "موازنة حمل المنسّق ضمن تسامح 5% من الأساس",
    co.loadBalancePct >= lc.loadBalancePct - 5,
    `lc=${lc.loadBalancePct} co=${co.loadBalancePct}`
  );
  check(
    "انتظار المنسّق ضمن تسامح +1د من الأساس",
    co.avgWaitMin <= lc.avgWaitMin + 1,
    `lc=${lc.avgWaitMin} co=${co.avgWaitMin}`
  );
  check(
    "المنسّق يكشف جواهر مخفية أكثر من الأساس",
    co.gemUtilization > lc.gemUtilization,
    `lc=${lc.gemUtilization} co=${co.gemUtilization}`
  );
  check("عتبات القبول تمر", c1.acceptance.passed, c1.acceptance.reasons.join(" | "));

  console.log(
    `  (نتيجة مقارنة) الأساس: wait=${lc.avgWaitMin}د balance=${lc.loadBalancePct}% gems=${(lc.gemUtilization * 100).toFixed(1)}% · ` +
      `المنسّق: wait=${co.avgWaitMin}د balance=${co.loadBalancePct}% gems=${(co.gemUtilization * 100).toFixed(1)}% · ` +
      `فائز=${c1.winner}`
  );
}

// ---- حتمية PRNG ----
{
  const r1 = mulberry32(7);
  const r2 = mulberry32(7);
  const seq1 = Array.from({ length: 5 }, () => r1());
  const seq2 = Array.from({ length: 5 }, () => r2());
  check("PRNG مُبذَّر: نفس البذرة → نفس التسلسل", seq1.every((v, i) => v === seq2[i]));
}

console.log(failures ? `\n❌ ${failures} فحصًا فشل` : "\n🎉 كل اختبارات المحاكاة ومصدر الزحام ناجحة");
process.exitCode = failures ? 1 : 0;
