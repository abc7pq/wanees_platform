// إسقاط جاف خالٍ من الطفرات لمُعاينة أثر تجاوزات الازدحام (dry-run) — البند (ب).
//
// يبني Site جديدًا من الكتالوج في كل استدعاء ولا يمسّ الكتالوج المُمرَّر ولا أي حالة حية
// (لا جلسات، لا قاعدة بيانات، لا write). نفس المدخلات → نفس المخرجات (حتمي).
import { Site } from "./site.ts";
import {
  computeZoneLoads,
  computeLoadBalancePct,
  diversionTargets,
  seasonIncentives,
} from "./coordinator.ts";
import { operationalImpact } from "./eval.ts";
import { selectIncentive, toIncentiveDisplay } from "./incentives/selector.ts";
import type { IncentiveDisplay, IncentiveDomain, IncentiveTrigger } from "./incentives/types.ts";

export interface DryRunOverride {
  zone: string;
  level: number;
}

export interface DryRunProjection {
  committed: false;
  atMinute: number;
  zones: ReturnType<typeof computeZoneLoads>;
  loadBalancePct: number;
  peakReductionPct: number;
  diversionTargets: ReturnType<typeof diversionTargets>;
  seasonIncentives: ReturnType<typeof seasonIncentives>;
  selectedIncentive: IncentiveDisplay | null;
  operationalImpact: number;
}

export class UnknownZoneError extends Error {
  readonly zone: string;
  constructor(zone: string) {
    super(`منطقة غير معروفة: ${zone}`);
    this.name = "UnknownZoneError";
    this.zone = zone;
  }
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * يعرض أثر تجاوزات الازدحام على خطة المنسّق دون أي كتابة.
 * `overrides` تُطبَّق على نسخة Site جديدة فقط؛ الكتالوج الأصلي لا يتغيّر.
 */
export function projectDryRun(
  catalog: ConstructorParameters<typeof Site>[0],
  minute: number,
  overrides: DryRunOverride[],
  incentives: IncentiveDomain[],
): DryRunProjection {
  // الأساس من نسخة منفصلة (قبل التجاوزات) لحساب خفض الذروة.
  const baselineSite = new Site(catalog);
  const baselineLoads = computeZoneLoads(baselineSite, minute);
  const baselineSaturated = baselineLoads.filter((zone) => zone.overThreshold).length;

  const site = new Site(catalog);
  const hour = Math.floor(minute / 60);
  for (const override of overrides) {
    if (!site.zones.has(override.zone)) throw new UnknownZoneError(override.zone);
    site.crowdOverrides.set(`${override.zone}:${hour}`, clamp01(override.level));
  }

  const zones = computeZoneLoads(site, minute);
  const saturatedAfter = zones.filter((zone) => zone.overThreshold).length;

  // موازنة الحمل: نسبة المناطق غير المشبعة (وزن موحّد للعرض، لا مسارات مخطّطة في المعاينة).
  const loadBalancePct = computeLoadBalancePct(
    zones.map((zone) => ({ zone: zone.zone, crowd: zone.crowd, plannedStops: 1 })),
    site.crowdThreshold,
  );
  const peakReductionPct = baselineSaturated
    ? Math.round(((baselineSaturated - saturatedAfter) / baselineSaturated) * 100)
    : 0;

  // حافز مقترح مرتبط بأكثر منطقة ازدحامًا بعد التجاوزات.
  let zoneStableKey: string | null = null;
  let crowdLevel = 0;
  for (const zone of zones) {
    if (zone.crowd > crowdLevel) {
      crowdLevel = zone.crowd;
      zoneStableKey = zone.zone;
    }
  }
  const selected = selectIncentive(incentives, {
    triggers: new Set<IncentiveTrigger>(["CROWD_OVERRIDE"]),
    zoneStableKey,
    crowdLevel,
    waitMinutes: 0,
    alreadyClaimedIds: new Set(),
  });

  return {
    committed: false,
    atMinute: minute,
    zones,
    loadBalancePct,
    peakReductionPct,
    diversionTargets: diversionTargets(site, minute),
    seasonIncentives: seasonIncentives(site, minute),
    selectedIncentive: selected ? toIncentiveDisplay(selected) : null,
    operationalImpact: operationalImpact(loadBalancePct, peakReductionPct),
  };
}
