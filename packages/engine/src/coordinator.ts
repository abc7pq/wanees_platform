// منسّق الحركة + منسّق الموسم — منطق حتمي مستقل عن البنية التحتية (ADR-002)
//
// يفصل هذا الملف مسؤوليتين وردتا في العرض (ص6) كمكوّنين مستقلين لم يكونا موحّدين بعد:
//   1) منسّق الحركة (TrafficCoordinator): يقرأ الازدحام لكل منطقة ويُصدر أهداف تحويل
//      لامتصاص الطلب في المناطق الأقل ازدحامًا — «نوزّع الحركة بذكاء… ما ننقل الزحمة».
//   2) منسّق الموسم (SeasonCoordinator): يوازن بين راحة الزائر ومصلحة الموقع
//      (ترويج الجواهر المخفية + تخفيف الذروة) ويُصدر حوافز مقترحة.
//
// الإخراج كائنات عادية؛ الواجهات تُسلسلها عبر عقد packages/contracts (لا تبعية عكسية هنا).

import { Site } from "./site.ts";
import type { CrowdDataSource } from "./crowd-source.ts";

export interface ZoneLoad {
  zone: string;
  name: string;
  crowd: number;         // 0..1
  loadFactor: number;    // 0..1 — صفر تحت عتبة التشبع
  overThreshold: boolean;
  spareCapacity: number; // 0..1 — مساحة لاستيعاب زوار إضافيين
}

export interface DiversionTarget {
  zone: string;
  name: string;
  score: number; // أعلى = أفضل هدف تحويل
  reason: "spare_capacity" | "hidden_gem" | "low_crowd";
}

export interface SeasonIncentive {
  zone: string;
  name: string;
  kind: "hidden_gem" | "peak_relief" | "comfort";
  priority: number; // 1 أعلى أولوية
  rationale: string;
}

export interface CoordinatorPlan {
  contractVersion: "v1";
  atMinute: number;
  zones: ZoneLoad[];
  diversionTargets: DiversionTarget[];
  incentives: SeasonIncentive[];
}

/** مدخل موازنة الحمل: إحصاء محطات مخطّطة لكل منطقة مع ازدحامها */
export interface ZoneStat {
  zone: string;
  crowd: number; // 0..1
  plannedStops: number;
}

export interface SeasonIncentiveOptions {
  limit?: number;
  /** (٢) مصدر زحام قابل للاستبدال — بلا مصدر = سلوك المنسّق السابق حرفيًا (توافق إصدار) */
  crowd?: CrowdDataSource;
}

/**
 * موازنة الحمل: نسبة المحطات في مناطق غير مشبعة مقابل الإجمالي.
 * نفس معادلة لوحة المشغّل الحالية — نُقلت هنا لتكون مصدرًا واحدًا للحقيقة.
 */
export function computeLoadBalancePct(stats: ZoneStat[], threshold: number): number {
  const total = stats.reduce((a, z) => a + z.plannedStops, 0);
  if (!total) return 100;
  const saturated = stats.reduce((a, z) => a + (z.crowd > threshold ? z.plannedStops : 0), 0);
  return Math.round((1 - saturated / total) * 100);
}

/** منسّق الحركة: أحمال المناطق عند دقيقة معيّنة */
export function computeZoneLoads(site: Site, minute: number, crowd?: CrowdDataSource): ZoneLoad[] {
  const crowdOf = crowdReader(site, minute, crowd);
  return [...site.zones.values()].map((z) => {
    const crowd = crowdOf(z.id);
    return {
      zone: z.id,
      name: z.name,
      crowd: round2(crowd),
      loadFactor: round2(site.zoneLoadFactor(z.id, minute)),
      overThreshold: crowd > site.crowdThreshold,
      spareCapacity: round2(Math.max(0, 1 - crowd)),
    };
  });
}

/** منسّق الحركة: أهداف التحويل — المناطق الأقل ازدحامًا القادرة على امتصاص الطلب */
export function diversionTargets(site: Site, minute: number, limit = 5, crowd?: CrowdDataSource): DiversionTarget[] {
  return computeZoneLoads(site, minute, crowd)
    .filter((z) => !z.overThreshold)
    .map((z) => {
      const pop = site.zones.get(z.zone)?.popularity ?? 0.5;
      const hiddenGem = pop <= 0.7;
      const reason: DiversionTarget["reason"] =
        z.crowd <= 0.45 ? "low_crowd" : hiddenGem ? "hidden_gem" : "spare_capacity";
      const score =
        z.spareCapacity * 70 + (hiddenGem ? 20 : 0) + (z.crowd <= 0.45 ? 10 : 0);
      return { zone: z.zone, name: z.name, score: round2(score), reason };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** منسّق الموسم: حوافز مقترحة توازن راحة الزائر ومصلحة الموقع */
export function seasonIncentives(site: Site, minute: number, opts: SeasonIncentiveOptions = {}): SeasonIncentive[] {
  const limit = opts.limit ?? 5;
  const loads = computeZoneLoads(site, minute, opts.crowd);
  const gems = loads
    .filter((z) => !z.overThreshold)
    .map((z) => ({ z, pop: site.zones.get(z.zone)?.popularity ?? 0.5 }))
    .filter((x) => x.pop <= 0.7)
    .sort((a, b) => a.pop - b.pop);

  const out: SeasonIncentive[] = gems.map((x) => ({
    zone: x.z.zone,
    name: x.z.name,
    kind: "hidden_gem" as const,
    priority: 1,
    rationale: `منطقة أقل شهرة (شعبية ${x.pop.toFixed(2)}) بمساحة استيعاب — حوافز لترويج تجاربها الممتازة غير المكتشفة.`,
  }));

  for (const z of loads.filter((z) => z.overThreshold)) {
    out.push({
      zone: z.zone,
      name: z.name,
      kind: "peak_relief" as const,
      priority: 2,
      rationale: `منطقة مشبعة (${Math.round(z.crowd * 100)}%) — حوافز لتحويل الزوار نحو بدائل أهدأ.`,
    });
  }

  return out.sort((a, b) => a.priority - b.priority).slice(0, limit);
}

/** الخطة الكاملة من المنسّقين معًا */
export function coordinatorPlan(site: Site, minute: number, opts: SeasonIncentiveOptions = {}): CoordinatorPlan {
  return {
    contractVersion: "v1",
    atMinute: minute,
    zones: computeZoneLoads(site, minute, opts.crowd),
    diversionTargets: diversionTargets(site, minute, 5, opts.crowd),
    incentives: seasonIncentives(site, minute, opts),
  };
}

/** يبني قارئ ازدحام: من مصدر محقون (٢) إن وُجد، وإلا من نموذج الموقع المدمج (توافق إصدار) */
function crowdReader(
  site: Site,
  minute: number,
  crowd: CrowdDataSource | undefined,
): (zoneId: string) => number {
  if (!crowd) return (zoneId) => site.crowd(zoneId, minute);
  const m = new Map(crowd.readZones(minute).map((z) => [z.zone, z.crowd]));
  return (zoneId) => {
    const v = m.get(zoneId);
    return v === undefined ? site.crowd(zoneId, minute) : v;
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
