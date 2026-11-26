// مشاركة الموقع المجهولة لقياس الزحام (بموافقة الزائر).
// POST: إحداثيات الجهاز → منطقة فقط (لا تُخزن الإحداثيات ولا معرف الجلسة) → تحديث قراءات الزحام المقاسة.
// DELETE: سحب المشاركة وحذف سجل هذا الجهاز فورًا.
import { z } from "zod";
import { prisma } from "@/lib/db";
import { loadPublishedEventCatalog } from "@/lib/db-catalog";
import { jsonData, jsonError } from "@/lib/api-response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getVisitorToken, resolveVisitorSession } from "@/lib/visitor-auth";
import { createVenueGeo } from "@/lib/venue-gps";
import { PRESENCE_TTL_MS, presenceDeviceKey, recordPresence, refreshPresenceCrowd, resolvePresenceZone } from "@/lib/presence";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

const presenceSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().min(0).max(5_000),
}).strict();

function salt() {
  return process.env.WANEES_RATE_LIMIT_SALT ?? "wanees-development-rate-salt";
}

async function sessionOrError(request: Request, eventSlug: string) {
  if (!getVisitorToken(request)) return { error: jsonError(request, "SESSION_TOKEN_REQUIRED", "يلزم رمز جلسة الزيارة.", 401) };
  if (!process.env.DATABASE_URL) return { error: jsonError(request, "DATABASE_UNAVAILABLE", "قياس الزحام يحتاج قاعدة بيانات مفعلة.", 503) };
  const session = await resolveVisitorSession(eventSlug, request);
  if (!session) return { error: jsonError(request, "SESSION_NOT_FOUND", "جلسة الزيارة غير موجودة أو انتهت.", 404) };
  return { session };
}

export async function POST(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  const resolved = await sessionOrError(request, eventSlug);
  if ("error" in resolved) return resolved.error;
  const { session } = resolved;

  const rate = await enforceRateLimit(request, { scope: `presence:${eventSlug}:${session.id}`, limit: 12 });
  if (!rate.allowed) {
    const response = jsonError(request, "RATE_LIMITED", "تحديثات الموقع كثيرة، حاول بعد قليل.", 429);
    response.headers.set("retry-after", String(rate.retryAfterSeconds));
    return response;
  }

  const parsed = presenceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(request, "INVALID_REQUEST", "بيانات الموقع غير صالحة.", 400);
  const catalog = await loadPublishedEventCatalog(eventSlug);
  if (!catalog || catalog.catalogVersionId !== session.catalogVersionId) {
    return jsonError(request, "CATALOG_VERSION_UNAVAILABLE", "نسخة الكتالوج المرتبطة بالجلسة غير متاحة.", 409);
  }
  // GPS needs the venue's own calibration (Venue.geoAnchorLat/Lng, metersPerUnit, rotationDeg).
  const calibration = catalog.navigation.calibration;
  if (!calibration) {
    return jsonData(request, { counted: false, reason: "unsupported" }, { persistence: "postgresql" }, { status: 202 });
  }
  const fix = resolvePresenceZone(createVenueGeo(calibration), parsed.data, catalog.catalog.routeGraph?.nodes ?? []);
  if (fix.status !== "ready") {
    return jsonData(request, { counted: false, reason: fix.status }, { persistence: "postgresql" }, { status: 202 });
  }
  const zone = await prisma.zone.findFirst({ where: { catalogVersionId: session.catalogVersionId, stableKey: fix.zone }, select: { id: true, stableKey: true, nameAr: true } });
  if (!zone) return jsonData(request, { counted: false, reason: "outside" }, { persistence: "postgresql" }, { status: 202 });

  const now = new Date();
  await recordPresence(prisma, { eventId: session.eventId, zoneId: zone.id, deviceKey: presenceDeviceKey(salt(), session.eventId, session.id, now), now });
  await refreshPresenceCrowd(prisma, { eventId: session.eventId, catalogVersionId: session.catalogVersionId, now });

  return jsonData(request, {
    counted: true,
    zone: { id: zone.stableKey, name: zone.nameAr },
    expiresInSeconds: PRESENCE_TTL_MS / 1000,
  }, { persistence: "postgresql" }, { status: 202 });
}

export async function DELETE(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  const resolved = await sessionOrError(request, eventSlug);
  if ("error" in resolved) return resolved.error;
  const { session } = resolved;
  const now = new Date();
  // المفتاح يتغير كل ساعة: احذف مفتاح الساعة الحالية والسابقة
  const keys = [now, new Date(now.getTime() - 3_600_000)].map((at) => presenceDeviceKey(salt(), session.eventId, session.id, at));
  const deleted = await prisma.presencePing.deleteMany({ where: { eventId: session.eventId, deviceKey: { in: keys } } });
  return jsonData(request, { deleted: deleted.count }, { persistence: "postgresql" });
}
