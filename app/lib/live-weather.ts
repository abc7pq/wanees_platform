// Live weather at the venue from Open-Meteo (free, no key), behind the WeatherSource contract.
// The engine stays network-free: this adapter lives in lib/ and hands the engine a plain reading.
// If the provider is slow or down, the deterministic stub answers and the reading says so.
import type { WeatherCondition, WeatherReading } from "../../packages/contracts/src/index.ts";
import { DeterministicWeatherSource } from "../engine/weather.ts";

const CACHE_MS = 10 * 60_000;
const TIMEOUT_MS = 4_000;

let cached: { key: string; value: LiveWeather; expiresAt: number } | null = null;

export type LiveWeather = WeatherReading & { live: boolean; windKmh?: number; summaryAr: string };

/** WMO weather interpretation codes (https://open-meteo.com/en/docs) to the shared contract. */
export function conditionForCode(code: number, temperatureCelsius: number, windKmh: number): WeatherCondition {
  if (code >= 51 && code <= 99) return "rain";
  if (windKmh >= 40) return "windy";
  if (temperatureCelsius >= 38) return "hot";
  if (temperatureCelsius <= 10) return "cold";
  if (code === 0 || code === 1) return "clear";
  if (code === 2) return "partly_cloudy";
  return "cloudy";
}

export function impactFor(condition: WeatherCondition, temperatureCelsius: number): WeatherReading["impactHint"] {
  if (temperatureCelsius >= 35 || condition === "hot") return "heat_precaution";
  if (temperatureCelsius <= 12 || condition === "cold") return "indoor_preferred";
  if (condition === "rain") return "rain_precaution";
  if (condition === "windy") return "wind_precaution";
  if (condition === "clear") return "outdoor_fine";
  return "no_impact";
}

const CONDITION_AR: Record<WeatherCondition, string> = {
  clear: "صحو", partly_cloudy: "غائم جزئيًا", cloudy: "غائم", rain: "ممطر", windy: "رياح نشطة", hot: "حار", cold: "بارد", unknown: "غير معروف",
};
const ADVICE_AR: Record<WeatherReading["impactHint"], string> = {
  outdoor_fine: "مناسب للأنشطة الخارجية.",
  no_impact: "ما يأثر على الجولة.",
  indoor_preferred: "الجو بارد، خذ معك جاكيت.",
  heat_precaution: "الجو حار، اشرب ماء وفضّل الأنشطة المغطاة.",
  rain_precaution: "فيه مطر، فضّل الأنشطة المغطاة وانتبه للممرات.",
  wind_precaution: "فيه رياح، بعض الألعاب العالية ممكن توقف مؤقتًا.",
};

export function summaryAr(reading: Pick<WeatherReading, "temperatureCelsius" | "condition" | "impactHint">) {
  return `${Math.round(reading.temperatureCelsius)}° ${CONDITION_AR[reading.condition]} · ${ADVICE_AR[reading.impactHint]}`;
}

/** Weather at the venue's calibrated GPS anchor (Venue.geoAnchorLat/Lng); null for an uncalibrated venue. */
export async function venueWeather(eventSlug: string, place: { lat: number; lng: number } | null | undefined, atMinute: number, fetcher: typeof fetch = fetch): Promise<LiveWeather | null> {
  if (!place) return null;
  if (cached && cached.key === eventSlug && cached.expiresAt > Date.now()) return cached.value;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lng}&current=temperature_2m,weather_code,wind_speed_10m&timezone=Asia%2FRiyadh`;
    const response = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`open-meteo ${response.status}`);
    const body = await response.json() as { current?: { time?: string; temperature_2m?: number; weather_code?: number; wind_speed_10m?: number } };
    const current = body.current;
    if (typeof current?.temperature_2m !== "number" || typeof current.weather_code !== "number") throw new Error("open-meteo: no current reading");
    const wind = current.wind_speed_10m ?? 0;
    const condition = conditionForCode(current.weather_code, current.temperature_2m, wind);
    const impactHint = impactFor(condition, current.temperature_2m);
    const value: LiveWeather = {
      region: eventSlug,
      at: current.time ? new Date(`${current.time}:00+03:00`).toISOString() : new Date().toISOString(),
      temperatureCelsius: Math.round(current.temperature_2m * 10) / 10,
      condition,
      impactHint,
      source: "open-meteo",
      live: true,
      windKmh: Math.round(wind),
      summaryAr: summaryAr({ temperatureCelsius: current.temperature_2m, condition, impactHint }),
    };
    cached = { key: eventSlug, value, expiresAt: Date.now() + CACHE_MS };
    return value;
  } catch {
    const stub = new DeterministicWeatherSource().reading("lagoon", atMinute);
    // Not cached: the next request tries the live provider again.
    return { ...stub, live: false, summaryAr: `${summaryAr(stub)} (تقدير، ما وصلتنا قراءة حية)` };
  }
}

/** Test hook: forget the cached reading. */
export function resetWeatherCache() {
  cached = null;
}
