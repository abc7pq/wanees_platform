// استشعار الزحام من أجهزة الزوار (نفس فكرة زحمة الطرق في خرائط Google):
// كل جهاز وافق صاحبه يرسل موقعه، الخادم يحوّله لمنطقة فقط ويعدّ الأجهزة النشطة في كل منطقة،
// ثم يقدّر عدد الناس (العيّنة ÷ نسبة مستخدمي التطبيق) ويقسمه على سعة المنطقة → مستوى زحام 0..1.
//
// الخصوصية:
// - لا نخزن الإحداثيات ولا معرف الجلسة؛ فقط المنطقة + مفتاح جهاز مجزأ بملح ويتغير كل ساعة.
// - كل سجل ينتهي بعد PRESENCE_TTL_MS، والتنظيف عبر npm run db:cleanup.
// - لا تُنشر قراءة لمنطقة فيها أقل من minDevices أجهزة (حماية من كشف فرد بعينه).
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { GpsRouteNode, VenueGeo } from "./venue-gps.ts";

export const PRESENCE_TTL_MS = 5 * 60_000;
export const SENSOR_SNAPSHOT_TTL_MS = 3 * 60_000;
export const SENSOR_REFRESH_MIN_MS = 30_000;

export type PresenceConfig = {
  /** نسبة الزوار الذين يشاركون موقعهم عبر التطبيق (0..1] — تحوّل العينة لتقدير إجمالي */
  sampleRate: number;
  /** أقل عدد أجهزة لنشر قراءة لمنطقة */
  minDevices: number;
  /** السعة الافتراضية للمنطقة (أشخاص) إذا لم يحددها المنظم */
  defaultCapacity: number;
};

export function presenceConfig(env: Record<string, string | undefined> = process.env): PresenceConfig {
  const number = (value: string | undefined, fallback: number, min: number, max: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
  };
  return {
    sampleRate: number(env.WANEES_PRESENCE_SAMPLE_RATE, 0.08, 0.001, 1),
    minDevices: Math.round(number(env.WANEES_PRESENCE_MIN_DEVICES, 3, 1, 50)),
    defaultCapacity: Math.round(number(env.WANEES_PRESENCE_DEFAULT_CAPACITY, 300, 10, 100_000)),
  };
}

/** مفتاح جهاز مجهول: ملح سري + الفعالية + الجلسة + الساعة الحالية → لا يمكن ربطه بالجلسة ولا تتبعه بين الساعات */
export function presenceDeviceKey(salt: string, eventId: string, sessionId: string, now: Date) {
  const hourBucket = Math.floor(now.getTime() / 3_600_000);
  return createHash("sha256").update(`presence:${salt}:${eventId}:${sessionId}:${hourBucket}`).digest("hex").slice(0, 40);
}

export type PresenceFix =
  | { status: "inaccurate" }
  | { status: "outside" }
  | { status: "ready"; zone: string; nodeId: string; distanceM: number };

/** GPS → أقرب عقدة مشي مفتوحة لها منطقة (ضمن 120م) — الإحداثيات لا تخرج من هذه الدالة */
export function resolvePresenceZone(
  geo: VenueGeo,
  coordinates: { latitude: number; longitude: number; accuracy: number },
  nodes: readonly (GpsRouteNode & { zone?: string | null })[],
): PresenceFix {
  const { latitude, longitude, accuracy } = coordinates;
  if (![latitude, longitude, accuracy].every(Number.isFinite) || accuracy < 0 || accuracy > 75) return { status: "inaccurate" };
  const point = geo.fromLatLng(latitude, longitude);
  let best: { node: GpsRouteNode & { zone?: string | null }; distance: number } | null = null;
  for (const node of nodes) {
    if (node.status !== "open" || !node.zone) continue;
    const distance = geo.distanceMeters(point, node);
    if (!best || distance < best.distance || (distance === best.distance && node.id < best.node.id)) best = { node, distance };
  }
  if (!best || best.distance > 120 || !best.node.zone) return { status: "outside" };
  return { status: "ready", zone: best.node.zone, nodeId: best.node.id, distanceM: Math.round(best.distance) };
}

export type ZonePresenceReading = { zoneId: string; devices: number; estimatedPeople: number; level: number; confidence: number };

/** عدد الأجهزة لكل منطقة → مستوى زحام. مناطق تحت الحد الأدنى لا تُنشر. */
export function crowdFromPresence(
  counts: ReadonlyMap<string, number>,
  capacities: ReadonlyMap<string, number | null | undefined>,
  config: PresenceConfig,
): ZonePresenceReading[] {
  const readings: ZonePresenceReading[] = [];
  for (const [zoneId, devices] of [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (devices < config.minDevices) continue;
    const capacity = Math.max(1, capacities.get(zoneId) ?? config.defaultCapacity);
    const estimatedPeople = Math.round(devices / config.sampleRate);
    const level = Math.min(1, Math.round((estimatedPeople / capacity) * 100) / 100);
    // ثقة تزيد مع حجم العينة (≈0.5 عند الحد الأدنى، تقترب من 1 مع 25 جهازًا)
    const confidence = Math.min(1, Math.round((0.35 + devices / 40) * 100) / 100);
    readings.push({ zoneId, devices, estimatedPeople, level, confidence });
  }
  return readings;
}

/** يسجل آخر منطقة للجهاز ثم يحدّث لقطات الزحام المقاسة للفعالية */
export async function recordPresence(
  db: Prisma.TransactionClient,
  input: { eventId: string; zoneId: string; deviceKey: string; now: Date },
) {
  const expiresAt = new Date(input.now.getTime() + PRESENCE_TTL_MS);
  await db.presencePing.upsert({
    where: { eventId_deviceKey: { eventId: input.eventId, deviceKey: input.deviceKey } },
    update: { zoneId: input.zoneId, seenAt: input.now, expiresAt },
    create: { eventId: input.eventId, zoneId: input.zoneId, deviceKey: input.deviceKey, seenAt: input.now, expiresAt },
  });
}

export async function refreshPresenceCrowd(
  db: Prisma.TransactionClient,
  input: { eventId: string; catalogVersionId: string; now: Date; config?: PresenceConfig },
) {
  const config = input.config ?? presenceConfig();
  const grouped = await db.presencePing.groupBy({
    by: ["zoneId"],
    where: { eventId: input.eventId, expiresAt: { gt: input.now }, zone: { catalogVersionId: input.catalogVersionId } },
    _count: { _all: true },
  });
  const counts = new Map(grouped.map((row) => [row.zoneId, row._count._all]));
  if (!counts.size) return [];
  const zones = await db.zone.findMany({ where: { id: { in: [...counts.keys()] } }, select: { id: true, capacity: true } });
  const readings = crowdFromPresence(counts, new Map(zones.map((zone) => [zone.id, zone.capacity])), config);
  const written: ZonePresenceReading[] = [];
  for (const reading of readings) {
    const recent = await db.crowdSnapshot.findFirst({
      where: { eventId: input.eventId, zoneId: reading.zoneId, source: "SENSOR", observedAt: { gt: new Date(input.now.getTime() - SENSOR_REFRESH_MIN_MS) } },
      orderBy: { observedAt: "desc" },
      select: { level: true },
    });
    if (recent && Math.abs(recent.level - reading.level) < 0.05) continue;
    await db.crowdSnapshot.create({
      data: {
        eventId: input.eventId,
        zoneId: reading.zoneId,
        level: reading.level,
        source: "SENSOR",
        confidence: reading.confidence,
        observedAt: input.now,
        expiresAt: new Date(input.now.getTime() + SENSOR_SNAPSHOT_TTL_MS),
      },
    });
    written.push(reading);
  }
  return written;
}
