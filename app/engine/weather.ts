// مصدر الطقس — منفذ قابل للاستبدال + مصدر stub حتمي (بلا مزود فعلي)
//
// يعيش في طبقة domain (app/engine) بلا أي اعتماد على framework أو قاعدة بيانات
// أو بيئة تشغيل أو شبكة. أي مزود طقس حقيقي لاحقًا يطبّق واجهة WeatherSource نفسها
// ويُحقن مكان المصدر الحتمي دون تغيير المستهلكين.

import type {
  WeatherReading,
  WeatherCondition,
  WeatherImpactHint,
} from "../../packages/contracts/src/index.ts";

/** منفذ (port) قراءة حالة الطقس لمنطقة/توقيت — الواجهة الوحيدة التي يعتمد عليها المستهلك. */
export interface WeatherSource {
  /** معرّف المصدر المستقر (يظهر في WeatherReading.source). */
  readonly sourceId: string;
  /** قراءة حالة الطقس لمنطقة داخل الفعالية عند دقيقة اليوم (minutes since midnight). */
  reading(region: string, atMinute: number): WeatherReading;
}

interface RegionClimate {
  baseCelsius: number;
  amplitudeCelsius: number;
  condition: WeatherCondition;
}

// بيانات مناخ مرجعية ثابتة (aggregated) توضح شكل الواجهة فقط؛ ليست قياسات حية
// وتُستبدل بمزود طقس حقيقي لاحقًا عبر نفس الواجهة.
const REGION_CLIMATES: Record<string, RegionClimate> = {
  lagoon: { baseCelsius: 26, amplitudeCelsius: 4, condition: "clear" },
  africa: { baseCelsius: 28, amplitudeCelsius: 4, condition: "partly_cloudy" },
  courchevel: { baseCelsius: 15, amplitudeCelsius: 3, condition: "windy" },
  saudi: { baseCelsius: 30, amplitudeCelsius: 5, condition: "clear" },
  japan: { baseCelsius: 24, amplitudeCelsius: 3, condition: "cloudy" },
  france: { baseCelsius: 20, amplitudeCelsius: 3, condition: "rain" },
};

const DEFAULT_CLIMATE: RegionClimate = {
  baseCelsius: 27,
  amplitudeCelsius: 4,
  condition: "clear",
};

// مرجع زمني ثابت لاشتقاق الطابع الزمني الحتمي (يوم ديمو ثابت لا يتغير).
const ANCHOR_MS = Date.UTC(2026, 10, 21);

export class DeterministicWeatherSource implements WeatherSource {
  readonly sourceId = "deterministic-stub";

  reading(region: string, atMinute: number): WeatherReading {
    const climate = REGION_CLIMATES[region] ?? DEFAULT_CLIMATE;
    const temperatureCelsius = round1(diurnalTemperature(climate, atMinute));
    return {
      region,
      at: new Date(ANCHOR_MS + atMinute * 60_000).toISOString(),
      temperatureCelsius,
      condition: climate.condition,
      impactHint: impactHintFor(climate.condition, temperatureCelsius),
      source: this.sourceId,
    };
  }
}

/** منحنى حراري يومي حتمي: الأدنى ~05:00 والذروة ~17:00. */
function diurnalTemperature(climate: RegionClimate, atMinute: number): number {
  const hour = Math.floor(atMinute / 60) % 24;
  const phase = ((hour - 5) / 24) * 2 * Math.PI;
  const factor = (1 - Math.cos(phase)) / 2; // 0 عند 05:00 → 1 عند 17:00
  return (
    climate.baseCelsius -
    climate.amplitudeCelsius +
    2 * climate.amplitudeCelsius * factor
  );
}

function impactHintFor(
  condition: WeatherCondition,
  temperatureCelsius: number
): WeatherImpactHint {
  if (temperatureCelsius >= 35) return "heat_precaution";
  if (temperatureCelsius <= 12) return "indoor_preferred";
  switch (condition) {
    case "rain":
      return "rain_precaution";
    case "windy":
      return "wind_precaution";
    case "cloudy":
    case "partly_cloudy":
      return "no_impact";
    default:
      return "outdoor_fine";
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** المصدر الحتمي الجاهز للحقن (الافتراضي حتى يُعتمد مزود حقيقي). */
export function defaultWeatherSource(): WeatherSource {
  return new DeterministicWeatherSource();
}

/**
 * نقطة الحقن المعلنة مع منسّق الموسم (البند ج — يبنيه Multi-Agent Systems Architect).
 *
 * لا يُنفَّذ منطق المنسّق هنا إطلاقًا. هذا فقط العقد الذي يحدد كيف يحصل المنسّق على
 * مصدر الطقس عبر حقن المُنشئ (constructor injection):
 *
 *   const coordinator = new SeasonCoordinator({ weather: defaultWeatherSource(), ... });
 *
 * إذا اختلف توقيع واجهة المنسّق الفعلي عند دمج البند ج، يُعدَّل هذا النوع فقط،
 * ويبقى عقد WeatherSource والمصدر الحتمي دون تغيير.
 */
export interface SeasonCoordinatorDeps {
  readonly weather: WeatherSource;
  // مصادر أخرى (crowd / events / catalog) يملكها صاحب البند ج وتُضاف هنا عند الدمج.
}
