// تعليمات المشي خطوة بخطوة (مثل «بعد ٤٠ م لف يمين عند منطقة الصين») محسوبة من هندسة المسار فقط.
// الإحداثيات بوحدات الموقع (x شرقًا، y جنوبًا)؛ المسافات بالأمتار حسب metersPerUnit من معايرة الموقع.
import type { VenuePoint } from "./venue-gps.ts";

function planarDistanceMeters(a: VenuePoint, b: VenuePoint, metersPerUnit: number) {
  return Math.hypot(a.x - b.x, a.y - b.y) * metersPerUnit;
}

export type TurnKind = "straight" | "slight_right" | "right" | "sharp_right" | "slight_left" | "left" | "sharp_left" | "uturn" | "arrive";
export type Maneuver = { nodeIndex: number; kind: TurnKind; label: string | null };

export function bearingDegrees(from: VenuePoint, to: VenuePoint) {
  const degrees = (Math.atan2(to.x - from.x, -(to.y - from.y)) * 180) / Math.PI;
  return (degrees + 360) % 360;
}

/** فرق الاتجاه الموقّع: موجب = لف يمين (مع عقارب الساعة) */
export function turnDelta(inBearing: number, outBearing: number) {
  return ((outBearing - inBearing + 540) % 360) - 180;
}

export function classifyTurn(delta: number): TurnKind {
  const size = Math.abs(delta);
  if (size < 25) return "straight";
  if (size >= 155) return "uturn";
  const side = delta > 0 ? "right" : "left";
  if (size < 60) return `slight_${side}` as TurnKind;
  if (size < 120) return side;
  return `sharp_${side}` as TurnKind;
}

/** المناورات عند كل عقدة داخلية فيها انعطاف، ثم الوصول عند آخر نقطة */
export function buildManeuvers(points: readonly VenuePoint[], labels: ReadonlyArray<string | null | undefined>, metersPerUnit: number): Maneuver[] {
  const maneuvers: Maneuver[] = [];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const here = points[index];
    const next = points[index + 1];
    if (planarDistanceMeters(previous, here, metersPerUnit) < 1 || planarDistanceMeters(here, next, metersPerUnit) < 1) continue;
    const kind = classifyTurn(turnDelta(bearingDegrees(previous, here), bearingDegrees(here, next)));
    if (kind !== "straight") maneuvers.push({ nodeIndex: index, kind, label: labels[index] ?? null });
  }
  if (points.length) maneuvers.push({ nodeIndex: points.length - 1, kind: "arrive", label: labels[points.length - 1] ?? null });
  return maneuvers;
}

/** المسافة على المسار من موقع الزائر (متجهًا للعقدة `waypoint`) حتى العقدة `nodeIndex` */
export function distanceAlongPath(points: readonly VenuePoint[], me: VenuePoint, waypoint: number, nodeIndex: number, metersPerUnit: number) {
  if (nodeIndex < waypoint) return 0;
  let distance = planarDistanceMeters(me, points[waypoint], metersPerUnit);
  for (let index = waypoint; index < nodeIndex; index += 1) distance += planarDistanceMeters(points[index], points[index + 1], metersPerUnit);
  return distance;
}

export function nextManeuver(maneuvers: readonly Maneuver[], waypoint: number) {
  return maneuvers.find((maneuver) => maneuver.nodeIndex >= waypoint) ?? null;
}

/** أقرب مسافة من الزائر لأي مقطع في المسار (لاكتشاف الخروج عن الطريق) */
export function distanceFromPath(points: readonly VenuePoint[], me: VenuePoint, metersPerUnit: number) {
  if (points.length === 1) return planarDistanceMeters(me, points[0], metersPerUnit);
  let best = Infinity;
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? Math.max(0, Math.min(1, ((me.x - a.x) * dx + (me.y - a.y) * dy) / lengthSquared)) : 0;
    best = Math.min(best, planarDistanceMeters(me, { x: a.x + dx * t, y: a.y + dy * t }, metersPerUnit));
  }
  return best;
}

const TURN_TEXT: Record<TurnKind, string> = {
  straight: "كمّل على طول",
  slight_right: "مِل يمين",
  right: "لف يمين",
  sharp_right: "لف يمين بقوة",
  slight_left: "مِل يسار",
  left: "لف يسار",
  sharp_left: "لف يسار بقوة",
  uturn: "ارجع للخلف",
  arrive: "توصل",
};

export const TURN_ICON: Record<TurnKind, string> = {
  straight: "⬆️", slight_right: "↗️", right: "➡️", sharp_right: "↘️", slight_left: "↖️", left: "⬅️", sharp_left: "↙️", uturn: "↩️", arrive: "🏁",
};

/** تقريب المسافة للنطق: لأقرب ٥ تحت ٥٠م ولأقرب ١٠ فوقها */
export function roundMeters(meters: number) {
  const step = meters < 50 ? 5 : 10;
  return Math.max(step, Math.round(meters / step) * step);
}

export function describeManeuver(maneuver: Maneuver, metersAway: number, destinationName?: string) {
  if (maneuver.kind === "arrive") {
    return metersAway <= 15 ? `وصلت إلى ${destinationName ?? "وجهتك"}` : `بعد ${roundMeters(metersAway)} م توصل إلى ${destinationName ?? "وجهتك"}`;
  }
  const at = maneuver.label ? ` عند ${maneuver.label}` : "";
  return metersAway <= 15 ? `${TURN_TEXT[maneuver.kind]}${at} الحين` : `بعد ${roundMeters(metersAway)} م ${TURN_TEXT[maneuver.kind]}${at}`;
}
