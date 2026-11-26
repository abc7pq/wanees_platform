// حزام المحاكاة المقارنة (ص11 «نختبر بالمحاكاة: نقارن التوصية بتوجيه الزائر للأقل ازدحامًا»)
//
// فجوة (١) من عرض wanees2: العرض يطالب بمقارنة توصية المنسّق مع خط الأساس الساذج
// «وجّه الزائر دائمًا للأقل ازدحامًا». هذا الحزام يُنفّذ المقارنة بشكل حتمي:
//   1) خط الأساس «الأقل ازدحامًا»: طمّاع يختار المنطقة الأدنى ازدحامًا حاليًا.
//   2) استراتيجية المنسّق: تُعيد استخدام diversionTargets الحقيقي من (ج) — أي
//      نفس المنطق الذي يوجّه الزائر فعليًا (سعة استيعاب + جواهر مخفية + انخفاض زحام)،
//      عبر تِماس crowd القابل للاستبدال (٢). بلا منطق جديد مبعثر.
//
// حتمية بالكامل: PRNG مُبذَّر + طابور متطوّر بلا عشوائية → نفس البذرة = نفس النتيجة.
// بلا LLM، بلا شبكة، بلا child_process — يشغّلها node مباشرة.

import { Site } from "./site.ts";
import { diversionTargets, computeLoadBalancePct } from "./coordinator.ts";
import type { CrowdDataSource, ZoneCrowdSnapshot } from "./crowd-source.ts";
import { mulberry32 } from "./crowd-source.ts";

export type SimulationStrategy = "least_crowded" | "coordinator";

export interface SimulationZoneSpec {
  id: string;
  name: string;
  popularity: number; // 0..1 — يحدد «الجوهرة المخفية» (≤ 0.7)
  capacity: number; // أقصى زوار متزامنين قبل التشبع
  serviceRatePerMin: number; // معدل امتصاص الزوار (زوار/دقيقة)
}

export interface SimulationScenario {
  seed: number;
  horizonMinutes: number;
  arrivalsPerMin: number; // متوسط وصول الزوار في الدقيقة
  zones: SimulationZoneSpec[];
}

export interface StrategyOutcome {
  strategy: SimulationStrategy;
  visitors: number;
  totalWaitMin: number;
  avgWaitMin: number;
  loadBalancePct: number; // متوسط نسبة المحطات في مناطق غير مشبعة على الأفق
  peakCrowd: number; // أعلى ازدحام 0..1 رُصد على أي منطقة/دقيقة
  overflow: number; // زوار تعذّر توجيههم (كل المناطق ممتلئة)
  gemUtilization: number; // نسبة الموجَّهين إلى جواهر مخفية (شعبية ≤ 0.7)
}

export interface SimulationComparison {
  contractVersion: "v1";
  seed: number;
  horizonMinutes: number;
  leastCrowded: StrategyOutcome;
  coordinator: StrategyOutcome;
  winner: SimulationStrategy | "tie";
  acceptance: { passed: boolean; reasons: string[] };
}

/** حالة زحام حيّة يملكها الحزام نفسه — تطبّق CrowdDataSource كي يقرأها المنسّق عبر التِماس (٢) */
class SimulationCrowdState implements CrowdDataSource {
  readonly kind = "live_simulation";
  queues = new Map<string, number>();
  private readonly zones: SimulationZoneSpec[];
  constructor(zones: SimulationZoneSpec[]) {
    this.zones = zones;
    for (const z of zones) this.queues.set(z.id, 0);
  }
  readZones(atMinute: number): ZoneCrowdSnapshot[] {
    return this.zones.map((z) => ({
      zone: z.id,
      crowd: round4(Math.min(1, (this.queues.get(z.id) ?? 0) / z.capacity)),
      updatedAtMinute: atMinute,
    }));
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function siteFor(zones: SimulationZoneSpec[]): Site {
  return new Site({
    meta: { source: "simulation", note: "", currency: "SAR" },
    site: {
      name: "Simulation venue",
      walking_speed_m_per_min: 60,
      min_walk_min: 1,
      opening: { from: 0, to: 1440 },
      crowd_threshold: 0.75,
      base_crowd_curve: {},
    },
    zones: zones.map((z) => ({ id: z.id, name: z.name, x: 0, y: 0, popularity: z.popularity })),
    activities: [],
  });
}

/** اختيار منطقة لزائر واحد وفق الاستراتيجية (طمّاعة أو منسّق) */
function pickZone(
  strategy: SimulationStrategy,
  site: Site,
  state: SimulationCrowdState,
  zoneById: Map<string, SimulationZoneSpec>,
  minute: number,
): string | null {
  const readings = state.readZones(minute);
  if (strategy === "least_crowded") {
    const sorted = [...readings].sort((a, b) => a.crowd - b.crowd || a.zone.localeCompare(b.zone));
    return sorted[0]?.zone ?? null;
  }
  // منسّق: يُعيد استخدام diversionTargets الحقيقي (ج) مع تِماس crowd (٢)
  const targets = diversionTargets(site, minute, 5, state);
  if (targets.length) return targets[0].zone;
  // مسار هابط حتمي: كل المناطق فوق العتبة → الأقل ازدحامًا (طمّاعة مضمونة)
  const sorted = [...readings].sort((a, b) => a.crowd - b.crowd || a.zone.localeCompare(b.zone));
  return sorted[0]?.zone ?? null;
}

/** تشغيل أفق محاكاة كامل باستراتيجية واحدة وإرجاع النتيجة */
export function runStrategy(scenario: SimulationScenario, strategy: SimulationStrategy): StrategyOutcome {
  const rand = mulberry32(scenario.seed ^ (strategy === "coordinator" ? 0x9e3779b9 : 0));
  const zoneById = new Map(scenario.zones.map((z) => [z.id, z]));
  const site = siteFor(scenario.zones);
  const state = new SimulationCrowdState(scenario.zones);

  let visitors = 0;
  let totalWaitMin = 0;
  let overflow = 0;
  let gemRouted = 0;
  let loadBalanceSum = 0;
  let peakCrowd = 0;

  for (let minute = 0; minute < scenario.horizonMinutes; minute++) {
    const arrivals = deterministicArrivals(rand, scenario.arrivalsPerMin);
    for (let i = 0; i < arrivals; i++) {
      visitors++;
      const zone = pickZone(strategy, site, state, zoneById, minute);
      if (zone === null) {
        overflow++;
        continue;
      }
      const spec = zoneById.get(zone)!;
      const q = state.queues.get(zone) ?? 0;
      if (q >= spec.capacity) {
        // المنطقة ممتلئة — عمليًا لا تختارها أي استراتيجية إلا لو كل المناطق ممتلئة
        overflow++;
        continue;
      }
      totalWaitMin += q / spec.serviceRatePerMin; // انتظار خلف الطابور الحالي
      if (spec.popularity <= 0.7) gemRouted++;
      state.queues.set(zone, q + 1);
      peakCrowd = Math.max(peakCrowd, (q + 1) / spec.capacity);
    }
    // خدمة الطوابير في نهاية كل دقيقة
    for (const z of scenario.zones) {
      const q = state.queues.get(z.id) ?? 0;
      state.queues.set(z.id, Math.max(0, q - z.serviceRatePerMin));
    }
    const stats = scenario.zones.map((z) => ({
      zone: z.id,
      crowd: round4(Math.min(1, (state.queues.get(z.id) ?? 0) / z.capacity)),
      plannedStops: state.queues.get(z.id) ?? 0,
    }));
    loadBalanceSum += computeLoadBalancePct(stats, 0.75);
  }

  const placed = visitors - overflow;
  return {
    strategy,
    visitors,
    totalWaitMin: round4(totalWaitMin),
    avgWaitMin: placed ? round4(totalWaitMin / placed) : 0,
    loadBalancePct: scenario.horizonMinutes ? Math.round(loadBalanceSum / scenario.horizonMinutes) : 100,
    peakCrowd: round4(peakCrowd),
    overflow,
    gemUtilization: placed ? round4(gemRouted / placed) : 0,
  };
}

function deterministicArrivals(rand: () => number, rate: number): number {
  const base = Math.floor(rate);
  return base + (rand() < rate - base ? 1 : 0);
}

/** مقارنة head-to-head مع عتبات القبول — ص11 «قارن التوصية بالأقل ازدحامًا» */
export function compareStrategies(scenario: SimulationScenario): SimulationComparison {
  const leastCrowded = runStrategy(scenario, "least_crowded");
  const coordinator = runStrategy(scenario, "coordinator");

  const reasons: string[] = [];
  // القبول: المنسّق لا يجعل الازدحام أسوأ، ولا يزيد الانتظار، ويُحسّن كشف الجواهر
  if (coordinator.loadBalancePct >= leastCrowded.loadBalancePct - 5) {
    reasons.push(`موازنة حمل المنسّق ${coordinator.loadBalancePct}% ضمن تسامح 5% من الأساس ${leastCrowded.loadBalancePct}%`);
  } else {
    reasons.push(`⚠️ موازنة حمل المنسّق ${coordinator.loadBalancePct}% أدنى من الأساس ${leastCrowded.loadBalancePct}% بأكثر من التسامح`);
  }
  if (coordinator.avgWaitMin <= leastCrowded.avgWaitMin + 1) {
    reasons.push(`انتظار المنسّق ${coordinator.avgWaitMin}د ضمن تسامح +1د من الأساس ${leastCrowded.avgWaitMin}د`);
  } else {
    reasons.push(`⚠️ انتظار المنسّق ${coordinator.avgWaitMin}د أسوأ من الأساس ${leastCrowded.avgWaitMin}د بأكثر من التسامح`);
  }
  if (coordinator.gemUtilization > leastCrowded.gemUtilization) {
    reasons.push(`كشف جواهر المنسّق ${(coordinator.gemUtilization * 100).toFixed(1)}% أعلى من الأساس ${(leastCrowded.gemUtilization * 100).toFixed(1)}%`);
  } else {
    reasons.push(`⚠️ كشف جواهر المنسّق ${(coordinator.gemUtilization * 100).toFixed(1)}% ليس أعلى من الأساس ${(leastCrowded.gemUtilization * 100).toFixed(1)}%`);
  }
  if (coordinator.overflow <= leastCrowded.overflow) {
    reasons.push(`فائض المنسّق ${coordinator.overflow} ≤ الأساس ${leastCrowded.overflow}`);
  } else {
    reasons.push(`⚠️ فائض المنسّق ${coordinator.overflow} أكبر من الأساس ${leastCrowded.overflow}`);
  }

  const passed = reasons.every((r) => !r.startsWith("⚠️"));

  let winner: SimulationStrategy | "tie";
  if (coordinator.avgWaitMin < leastCrowded.avgWaitMin) winner = "coordinator";
  else if (leastCrowded.avgWaitMin < coordinator.avgWaitMin) winner = "least_crowded";
  else winner = "tie";

  return {
    contractVersion: "v1",
    seed: scenario.seed,
    horizonMinutes: scenario.horizonMinutes,
    leastCrowded,
    coordinator,
    winner,
    acceptance: { passed, reasons },
  };
}
