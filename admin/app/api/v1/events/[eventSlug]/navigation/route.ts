// Venue navigation settings for an event: live GPS guidance on/off, map accuracy, staff location
// simulation and the GPS calibration (audit items 0.2, 3.6, 3.7). Every change is audited.
// The setting belongs to the venue, so it applies to every event at that venue and takes effect
// without republishing the catalog (visitor catalog caches refresh within 30 seconds).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeEventRequest } from "@/lib/catalog-auth";
import { enforceAdminRateLimit, isSameOrigin } from "@/lib/request-security";
import { getRequestId, withAdminApiContract } from "@/lib/api-response";
import { navigationSettingsOf, validateNavigationPatch } from "@/lib/venue-navigation";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

const SELECT = {
  id: true,
  name: true,
  liveGuidance: true,
  navigationAccuracy: true,
  gpsSimulation: true,
  geoAnchorLat: true,
  geoAnchorLng: true,
  metersPerUnit: true,
  rotationDeg: true,
  updatedAt: true,
  _count: { select: { events: true } },
} as const;

function errorResponse(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, ...(details === undefined ? {} : { details }) } }, { status });
}

async function venueFor(eventId: string) {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { venue: { select: SELECT } } });
  return event?.venue ?? null;
}

function payload(venue: NonNullable<Awaited<ReturnType<typeof venueFor>>>) {
  return {
    venue: { id: venue.id, name: venue.name, sharedByEvents: venue._count.events },
    settings: navigationSettingsOf(venue as any),
    updatedAt: venue.updatedAt.toISOString(),
  };
}

export const GET = withAdminApiContract(async function GET(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  const access = await authorizeEventRequest(request, eventSlug, ["OWNER", "ADMIN", "OPERATOR", "EDITOR", "ANALYST", "VIEWER"]);
  if (!access.authorized) return errorResponse(access.userId ? "FORBIDDEN" : "UNAUTHORIZED", access.userId ? "لا تملك صلاحية هذه الفعالية." : "غير مصرح.", access.userId ? 403 : 401);
  if (!access.event) return errorResponse("EVENT_NOT_FOUND", "الفعالية غير موجودة.", 404);
  const venue = await venueFor(access.event.id);
  if (!venue) return errorResponse("VENUE_NOT_FOUND", "الفعالية غير مربوطة بموقع.", 404);
  return NextResponse.json({ data: payload(venue), meta: { persistence: "postgresql" } });
});

/** Body: any subset of the settings plus an optional `reason` and the `updatedAt` the organizer saw. */
export const PATCH = withAdminApiContract(async function PATCH(request: Request, context: Context) {
  if (!isSameOrigin(request)) return errorResponse("FORBIDDEN", "الطلب غير صادر من مصدر موثوق.", 403);
  const rate = await enforceAdminRateLimit(request, "venue-navigation", 20);
  if (!rate.allowed) return errorResponse("RATE_LIMITED", "تم تجاوز عدد محاولات التعديل. حاول بعد قليل.", 429);
  const { eventSlug } = await context.params;
  const access = await authorizeEventRequest(request, eventSlug, ["OWNER", "ADMIN"]);
  if (!access.authorized) return errorResponse(access.userId ? "FORBIDDEN" : "UNAUTHORIZED", access.userId ? "صلاحية مالك أو مدير المنظمة مطلوبة." : "غير مصرح.", access.userId ? 403 : 401);
  if (!access.event) return errorResponse("EVENT_NOT_FOUND", "الفعالية غير موجودة.", 404);

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const rawReason = body?.reason;
  if (rawReason !== undefined && typeof rawReason !== "string") return errorResponse("INVALID_REQUEST", "سبب التغيير يجب أن يكون نصًا.", 400);
  const reason = typeof rawReason === "string" ? rawReason.trim().slice(0, 300) || null : null;
  const seenAt = typeof body?.updatedAt === "string" ? body.updatedAt : null;
  const { updatedAt: _seen, ...changes } = body ?? {};

  const venue = await venueFor(access.event.id);
  if (!venue) return errorResponse("VENUE_NOT_FOUND", "الفعالية غير مربوطة بموقع.", 404);
  // Two organizers editing at once: refuse to overwrite settings changed since this one loaded them.
  if (seenAt && seenAt !== venue.updatedAt.toISOString()) {
    return errorResponse("NAVIGATION_CHANGED", "تغيّرت إعدادات الموقع منذ آخر تحميل. حدّث الصفحة ثم أعد المحاولة.", 409);
  }
  const before = navigationSettingsOf(venue as any);
  const result = validateNavigationPatch(before, body ? changes : body);
  if (!result.ok) return errorResponse(result.code, result.message, 400, result.field ? { field: result.field } : undefined);
  if (!result.changed.length) return NextResponse.json({ data: payload(venue), meta: { persistence: "postgresql", changed: [] } });

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.venue.update({ where: { id: venue.id }, data: result.settings, select: SELECT });
    await tx.auditLog.create({
      data: {
        organizationId: access.event!.organizationId,
        actorUserId: access.userId ?? undefined,
        action: "venue.navigation_change",
        entityType: "Venue",
        entityId: venue.id,
        beforeSummary: Object.fromEntries(result.changed.map((key) => [key, before[key]])),
        afterSummary: { ...Object.fromEntries(result.changed.map((key) => [key, result.settings[key]])), ...(reason ? { reason } : {}), eventSlug },
        requestId: getRequestId(request),
      },
    });
    return saved;
  });
  return NextResponse.json({ data: payload(updated), meta: { persistence: "postgresql", changed: result.changed } });
});
