// Validation for the venue navigation settings an organizer can change (audit items 0.2, 3.6, 3.7).
// Pure: no database, so the rules are unit-tested and the API route stays thin. The database CHECK
// constraints in prisma/migrations/20261127090000_venue_navigation repeat the same rules.

export type NavigationSettings = {
  liveGuidance: boolean;
  navigationAccuracy: "SURVEYED" | "APPROXIMATE";
  gpsSimulation: boolean;
  geoAnchorLat: number | null;
  geoAnchorLng: number | null;
  metersPerUnit: number | null;
  rotationDeg: number;
};

export type NavigationValidation =
  | { ok: true; settings: NavigationSettings; changed: (keyof NavigationSettings)[] }
  | { ok: false; code: "INVALID_REQUEST"; message: string; field?: string };

const FIELDS: (keyof NavigationSettings)[] = ["liveGuidance", "navigationAccuracy", "gpsSimulation", "geoAnchorLat", "geoAnchorLng", "metersPerUnit", "rotationDeg"];

function fail(message: string, field?: string): NavigationValidation {
  return { ok: false, code: "INVALID_REQUEST", message, field };
}

function optionalNumber(value: unknown): number | null | undefined | "invalid" {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : "invalid";
}

/**
 * Merges a PATCH body into the current settings and checks the result as a whole: a calibration is
 * all-or-nothing, and live guidance or simulation needs one (a GPS fix converted with a missing or
 * wrong anchor would guide the visitor the wrong way).
 */
export function validateNavigationPatch(current: NavigationSettings, body: unknown): NavigationValidation {
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("جسم الطلب غير صالح.");
  const input = body as Record<string, unknown>;
  const unknown = Object.keys(input).filter((key) => !FIELDS.includes(key as keyof NavigationSettings) && key !== "reason");
  if (unknown.length) return fail(`حقل غير معروف: ${unknown[0]}`, unknown[0]);
  const next: NavigationSettings = { ...current };

  for (const key of ["liveGuidance", "gpsSimulation"] as const) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== "boolean") return fail("القيمة يجب أن تكون نعم أو لا.", key);
    next[key] = input[key] as boolean;
  }
  if (input.navigationAccuracy !== undefined) {
    if (input.navigationAccuracy !== "SURVEYED" && input.navigationAccuracy !== "APPROXIMATE") return fail("دقة الخريطة يجب أن تكون «مسح ميداني» أو «تقريبية».", "navigationAccuracy");
    next.navigationAccuracy = input.navigationAccuracy;
  }
  for (const key of ["geoAnchorLat", "geoAnchorLng", "metersPerUnit"] as const) {
    const value = optionalNumber(input[key]);
    if (value === "invalid") return fail("أدخل رقمًا صحيحًا.", key);
    if (value !== undefined) next[key] = value;
  }
  const rotation = optionalNumber(input.rotationDeg);
  if (rotation === "invalid" || rotation === null) return fail("زاوية الدوران يجب أن تكون رقمًا.", "rotationDeg");
  if (rotation !== undefined) next.rotationDeg = rotation;

  const parts = [next.geoAnchorLat, next.geoAnchorLng, next.metersPerUnit];
  const someSet = parts.some((value) => value !== null);
  const allSet = parts.every((value) => value !== null);
  if (someSet && !allSet) return fail("المعايرة تحتاج خط العرض وخط الطول ومقياس المتر معًا، أو امسحها كلها.", "geoAnchorLat");
  if (next.geoAnchorLat !== null && (next.geoAnchorLat < -90 || next.geoAnchorLat > 90)) return fail("خط العرض بين ‎-90 و 90.", "geoAnchorLat");
  if (next.geoAnchorLng !== null && (next.geoAnchorLng < -180 || next.geoAnchorLng > 180)) return fail("خط الطول بين ‎-180 و 180.", "geoAnchorLng");
  if (next.metersPerUnit !== null && (next.metersPerUnit <= 0 || next.metersPerUnit > 100)) return fail("مقياس المتر لكل وحدة أكبر من 0 وحتى 100.", "metersPerUnit");
  if (next.rotationDeg < -180 || next.rotationDeg > 180) return fail("زاوية الدوران بين ‎-180 و 180 درجة.", "rotationDeg");
  if (next.liveGuidance && !allSet) return fail("التوجيه الحي يحتاج معايرة GPS كاملة للموقع أولًا.", "liveGuidance");
  if (next.gpsSimulation && !allSet) return fail("محاكاة الموقع تحتاج معايرة GPS كاملة للموقع أولًا.", "gpsSimulation");

  const changed = FIELDS.filter((key) => next[key] !== current[key]);
  return { ok: true, settings: next, changed };
}

export function navigationSettingsOf(venue: NavigationSettings): NavigationSettings {
  return Object.fromEntries(FIELDS.map((key) => [key, venue[key]])) as NavigationSettings;
}
