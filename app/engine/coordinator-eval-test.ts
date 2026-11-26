// اختبارات المنسّق وحزمة التقييم — قابلة للتشغيل ذاتيًا بلا بنية تحتية
// node --experimental-strip-types app/engine/coordinator-eval-test.ts
import { Site, defaultProfile } from "./site.ts";
import { buildRoute } from "./route.ts";
import {
  computeZoneLoads,
  diversionTargets,
  seasonIncentives,
  computeLoadBalancePct,
  coordinatorPlan,
} from "./coordinator.ts";
import {
  stageOf,
  routeQuality,
  easeOfUse,
  responseSpeed,
  operationalImpact,
  evaluateSuccess,
} from "./eval.ts";
import { catalogData } from "../data/catalog.ts";
import type { Profile } from "./types.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failures++;
    console.error(`  ❌ ${name} ${detail}`);
  }
}

// ---- fixture: موقع صغير بمناطق متفاوتة الازدحام ----
const fixture = {
  meta: { source: "coordinator-test", note: "", currency: "SAR" },
  site: {
    name: "Coordinator test venue",
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
    { id: "calm-a", name: "Calm A", zone: "calm", type: "culture", duration_min: 20, price: 0, family: true, interests: ["fun"], moods: ["fun"], popularity: 0.4, schedule: { type: "continuous" as const, from: 0, to: 1440 } },
  ],
};
const site = new Site(fixture);
const minute = 19 * 60 + 30; // 19:30

// ---- منسّق الحركة + منسّق الموسم ----
{
  const loads = computeZoneLoads(site, minute);
  const hot = loads.find((z) => z.zone === "hot")!;
  const calm = loads.find((z) => z.zone === "calm")!;
  const gem = loads.find((z) => z.zone === "gem")!;
  check("منطقة الذروة فوق العتبة", hot.overThreshold === true, `hot.crowd=${hot.crowd}`);
  check("المنطقة الهادئة تحت العتبة", calm.overThreshold === false, `calm.crowd=${calm.crowd}`);
  check("الجوهرة المخفية تحت العتبة", gem.overThreshold === false, `gem.crowd=${gem.crowd}`);
  check("المنطقة الهادئة لها سعة استيعاب", calm.spareCapacity > 0.25, `spare=${calm.spareCapacity}`);

  const div = diversionTargets(site, minute);
  check(
    "أهداف التحويل كلها تحت العتبة وغير فارغة",
    div.length >= 1 && div.every((d) => !loads.find((z) => z.zone === d.zone)!.overThreshold),
    `div=${div.map((d) => d.zone).join(",")}`
  );
  check(
    "أفضل هدف تحويل هو الأعلى سعة استيعاب",
    div[0]?.zone === "calm",
    `first=${div[0]?.zone}`
  );

  const inc = seasonIncentives(site, minute);
  check("الحوافز تبدأ بالجواهر المخفية", inc.length > 0 && inc[0].kind === "hidden_gem", `first=${inc[0]?.kind}`);

  const plan = coordinatorPlan(site, minute);
  check(
    "الخطة تحمل المناطق والأهداف والحوافز",
    plan.zones.length === 4 && plan.diversionTargets.length > 0 && plan.incentives.length > 0,
    `zones=${plan.zones.length} div=${plan.diversionTargets.length} inc=${plan.incentives.length}`
  );

  const balance = computeLoadBalancePct(
    [
      { zone: "hot", crowd: 0.9, plannedStops: 2 },
      { zone: "calm", crowd: 0.2, plannedStops: 3 },
    ],
    0.75
  );
  check("موازنة الحمل تحسب نسبة المحطات غير المشبعة", balance === 60, `balance=${balance}`);
}

// ---- حزمة التقييم ----
{
  const p: Profile = {
    ...defaultProfile(),
    mood: "fun",
    budget: 300,
    interests: ["fun"],
    companions_adults: 2,
    start_zone: "hot",
    duration_min: 90,
    start_min: 19 * 60,
  };
  const it = buildRoute(site, p);
  check("يبني مسارًا على الـfixture", it.stops.length > 0, `stops=${it.stops.length}`);

  const rq = routeQuality(site, p, it);
  check("جودة المسار ضمن 0..100", rq >= 0 && rq <= 100, `rq=${rq}`);

  check("سهولة الاستخدام تعكس اكتمال البروفايل", easeOfUse(p) === 100, `eou=${easeOfUse(p)}`);

  const fast = responseSpeed({ p50Ms: 60, p95Ms: 160 });
  const slow = responseSpeed({ p50Ms: 400, p95Ms: 700 });
  check("سرعة الاستجابة: سريع > بطيء", fast > slow, `fast=${fast} slow=${slow}`);

  check("الأثر التشغيلي يوازن الحمل وخفض الذروة", operationalImpact(100, 100) === 100 && operationalImpact(0, 0) === 0);

  check(
    "stageOf يعيد المرحلة الصحيحة",
    stageOf(85) === 80 && stageOf(75) === 70 && stageOf(12) === 60
  );

  const rep = evaluateSuccess(site, p, it, { p50Ms: 60, p95Ms: 160 }, 80, 20);
  check(
    "تقرير التقييم يحسب المرحلة الإجمالية",
    rep.metrics.length === 4 && rep.overallStage >= 60,
    `overall=${rep.overallStage}`
  );
}

// ---- دخان على الكتالوج الحقيقي (بوليفارد وورلد) ----
{
  const real = new Site(catalogData);
  const p: Profile = {
    ...defaultProfile(),
    start_zone: "lagoon",
    duration_min: 180,
    start_min: 19 * 60,
  };
  const it = buildRoute(real, p);
  check("يبني مسارًا على الكتالوج الحقيقي", it.stops.length > 0, `stops=${it.stops.length}`);

  const plan = coordinatorPlan(real, 19 * 60 + 30);
  check("منسّق الحركة يعمل على الكتالوج الحقيقي", plan.zones.length >= 10, `zones=${plan.zones.length}`);

  const rep = evaluateSuccess(real, p, it, { p50Ms: 60, p95Ms: 160 }, 80, 20);
  check("التقييم يعمل على الكتالوج الحقيقي", rep.metrics.length === 4, `overall=${rep.overallStage}`);
  console.log(
    `  (دخان حقيقي) overall=${rep.overallStage}% · ` +
      rep.metrics.map((m) => `${m.name}=${m.score}`).join(" · ")
  );
}

console.log(failures ? `\n❌ ${failures} فحصًا فشل` : "\n🎉 كل اختبارات المنسّق والتقييم ناجحة");
process.exitCode = failures ? 1 : 0;
