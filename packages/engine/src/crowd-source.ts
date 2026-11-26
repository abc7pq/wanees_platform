// مصدر بيانات الزحام القابل للاستبدال (ص6 «البوابات والعدّادات والتطبيق») + مصدر حتمي
//
// فجوة (٢) من عرض wanees2: العرض يطالب بـ«ربط بيانات الزحام الفعلية» (ص10/11)،
// والأجهزة (بوابات/عدّادات) ليست متاحة اليوم. ما يُبنى الآن — ويُبنى في أفضل صورة —
// هو التماس: واجهة CrowdDataSource قابلة للاستبدال + مصدر حتمي (محاكى) يقف مكان
// البوابات الحية حتى يتوفر القياس الميداني. نفس نمط WeatherSource في (د):
// لا تبعية على LLM، لا شبكة، لا child_process، ومصدر واحد للحقيقة.
//
// الاستهلاك في المنسّق عبر معامل اختياري crowd (تِماس مطابق للطقس):
//   coordinatorPlan(site, minute, { crowd: source })
// بلا مصدر = نفس سلوك المنسّق السابق حرفيًا (توافق إصدار).

export interface ZoneCrowdSnapshot {
  zone: string;
  crowd: number; // 0..1
  updatedAtMinute: number;
}

export interface CrowdReading {
  atMinute: number;
  zones: ZoneCrowdSnapshot[];
}

/** مصدر زحام قابل للاستبدال: قراءة واحدة تُعيد أحمال كل المناطق عند دقيقة معيّنة */
export interface CrowdDataSource {
  readonly kind: string;
  readZones(atMinute: number): ZoneCrowdSnapshot[];
}

/**
 * PRNG حتمي (mulberry32) — بذرة واحدة تُنتج التسلسل نفسه على أي منصة.
 * أساس «الحتمية» المطلوبة: نفس البذرة → نفس القراءات → نفس نتائج المحاكاة.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SimulatedCrowdConfig {
  seed: number;
  /** منحنى أساسي ساعة→ازدحام 0..1 (مطابق لمفهوم base_crowd_curve في الكتالوج) */
  baseCurve: Record<string, number>;
  /** شعبية كل منطقة 0..1 — تضخّم/تخفّض الازدحام الأساسي */
  zonePopularity: Record<string, number>;
  /** سعة ضوضاء حتمية (افتراضي 0.05)؛ 0 = لا ضوضاء إطلاقًا */
  noiseAmp?: number;
}

/**
 * مصدر زحام حتمي قابل لإعادة التشغيل: بذرة + إعدادات واحدة → قراءات متطابقة.
 * يقف مكان البوابات/العدّادات الحية في البيئة والمحاكاة، ويُستبدل لاحقًا بمصدر
 * يقرأ قياسًا ميدانيًا فعليًا دون تغيير أي مستهلك.
 */
export class SimulatedCrowdSource implements CrowdDataSource {
  readonly kind = "simulated";
  private readonly rand: () => number;
  private readonly baseCurve: Map<number, number>;
  private readonly popularity: Map<string, number>;
  private readonly noiseAmp: number;

  constructor(config: SimulatedCrowdConfig) {
    this.rand = mulberry32(config.seed);
    this.baseCurve = new Map(
      Object.entries(config.baseCurve).map(([h, v]) => [Number(h), v as number])
    );
    this.popularity = new Map(Object.entries(config.zonePopularity));
    this.noiseAmp = config.noiseAmp ?? 0.05;
  }

  readZones(atMinute: number): ZoneCrowdSnapshot[] {
    const hour = Math.floor(atMinute / 60);
    const base = this.baseCurve.get(hour) ?? 0.25;
    const zones: ZoneCrowdSnapshot[] = [];
    for (const [zone, pop] of this.popularity) {
      const noise = (this.rand() - 0.5) * 2 * this.noiseAmp; // محدد بنطاق الضوضاء
      const level = base * (0.6 + 0.4 * pop) + noise;
      zones.push({
        zone,
        crowd: round4(Math.min(1, Math.max(0, level))),
        updatedAtMinute: atMinute,
      });
    }
    return zones;
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
