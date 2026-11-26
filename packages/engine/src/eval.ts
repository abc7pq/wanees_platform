// حزمة تقييم النجاح — تحوّل مقاييس العرض الأربعة (ص11) إلى قياس حتمي قابل للتكرار:
//   1) جودة المسار · 2) سهولة الاستخدام · 3) سرعة الاستجابة · 4) الأثر التشغيلي
// مع أهداف مرحلية 60% / 70% / 80% كما في العرض المرفق.
//
// الحزم يستهلك أرقامًا، ولا يعتمد على المنسّق مباشرة؛ التكوين يتم في الطبقة الأعلى
// (الاختبار أو الواجهة) كي يبقى قابلًا للفصل والاختبار (ADR-002).

import { Site } from "./site.ts";
import type { Itinerary, Profile } from "./types.ts";

export type SuccessStage = 60 | 70 | 80;

export interface LatencyStats {
  p50Ms: number;
  p95Ms: number;
}

export interface SuccessMetricResult {
  name: string;
  score: number; // 0..100
  stage: SuccessStage;
  detail: string;
}

export interface EvalReport {
  contractVersion: "v1";
  at: string;
  metrics: SuccessMetricResult[];
  overallStage: SuccessStage;
  summary: string;
}

/** الأهداف المرحلية من العرض (60% → 70% → 80%). */
export const STAGE_TARGETS: ReadonlyArray<SuccessStage> = [60, 70, 80];

export function stageOf(score: number): SuccessStage {
  if (score >= 80) return 80;
  if (score >= 70) return 70;
  return 60;
}

/** 1) جودة المسار: درجة المحرك مطبّعة مع عقوبات المشي/الانتظار ومكافآت التنوع والإلزام */
export function routeQuality(site: Site, p: Profile, it: Itinerary): number {
  if (!it.stops.length) return 0;
  const walkTotal = it.stops.reduce((a, s) => a + s.walk_min, 0);
  const waitTotal = it.stops.reduce((a, s) => a + s.wait_min, 0);
  const zones = new Set(it.stops.map((s) => s.zone)).size;
  const variety = Math.min(1, zones / Math.max(1, it.stops.length));
  const must = p.must_include.filter((id) => !p.avoid.includes(id));
  const fulfilled = must.filter((id) => it.stops.some((s) => s.act_id === id)).length;
  const mustRatio = must.length ? fulfilled / must.length : 1;

  const engine = Math.max(0, Math.min(100, it.score / 4));
  const walkPenalty = Math.min(25, walkTotal * 1.0);
  const waitPenalty = Math.min(15, waitTotal * 0.5);
  return clamp100(engine + variety * 15 + mustRatio * 20 - walkPenalty - waitPenalty);
}

/** 2) سهولة الاستخدام: وكيل حتمي — اكتمال البروفايل يعني أسئلة أقل وتوصية أدق */
export function easeOfUse(p: Profile): number {
  let filled = 0;
  if (p.mood) filled++;
  if (p.budget != null) filled++;
  if (p.interests.length) filled++;
  if (p.companions_adults > 0 || p.companions_kids) filled++;
  if (p.must_include.length || p.duration_min > 0) filled++;
  return Math.round((filled / 5) * 100);
}

/** 3) سرعة الاستجابة: من p50/p95 مقابل أهداف العرض (p95 تحت 200ms هو الهدف المعلن) */
export function responseSpeed(lat: LatencyStats): number {
  const p50 = Math.max(0, Math.min(100, (1 - lat.p50Ms / 500) * 60));
  const p95 = Math.max(0, Math.min(100, (1 - lat.p95Ms / 800) * 40));
  return clamp100(Math.round(p50 + p95));
}

/** 4) الأثر التشغيلي: موازنة الحمل + خفض الذروة */
export function operationalImpact(loadBalancePct: number, peakReductionPct: number): number {
  return clamp100(Math.round(loadBalancePct * 0.6 + peakReductionPct * 0.4));
}

export function evaluateSuccess(
  site: Site,
  p: Profile,
  it: Itinerary,
  lat: LatencyStats,
  loadBalancePct: number,
  peakReductionPct: number,
): EvalReport {
  const metrics: SuccessMetricResult[] = [
    { name: "route_quality", score: routeQuality(site, p, it), stage: 60, detail: "" },
    { name: "ease_of_use", score: easeOfUse(p), stage: 60, detail: "" },
    { name: "response_speed", score: responseSpeed(lat), stage: 60, detail: "" },
    { name: "operational_impact", score: operationalImpact(loadBalancePct, peakReductionPct), stage: 60, detail: "" },
  ];
  for (const m of metrics) {
    m.stage = stageOf(m.score);
    m.detail = `score=${m.score}, stage=${m.stage}%`;
  }
  const overall = Math.min(...metrics.map((m) => m.stage)) as SuccessStage;
  return {
    contractVersion: "v1",
    at: new Date().toISOString(),
    metrics,
    overallStage: overall,
    summary:
      `المرحلة الإجمالية ${overall}% (أدنى مقياس) — ` +
      metrics.map((m) => `${m.name}=${m.score}`).join("، "),
  };
}

function clamp100(n: number): number {
  return Math.round(Math.max(0, Math.min(100, n)));
}
