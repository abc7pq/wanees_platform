import { buildRoute, fmtTime } from "@/engine/route.ts";
import { Site } from "@/engine/site.ts";
import { prisma } from "@/lib/db";
import { loadSessionCatalog } from "@/lib/db-catalog";
import { itineraryRequestSchema } from "@/lib/api-contracts";
import { getVisitorToken, resolveVisitorSession } from "@/lib/visitor-auth";
import { resolveVisitWindow } from "@/lib/visitor-profile";
import { activeLiveEvents } from "@/lib/active-live-events";
import { getEventClock } from "@/lib/event-clock";
import { toEngineItinerary, type StoredItinerary } from "@/lib/assistant";
import { enforceRateLimit } from "@/lib/rate-limit";
import { jsonData, jsonError as contractError } from "@/lib/api-response";
import { beginIdempotency, completeIdempotency, idempotencyErrorResponse, replayIdempotentResponse } from "@/lib/idempotency";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

function dateForPlanMinute(base: Date, startMinute: number, minute: number) {
  return new Date(base.getTime() + (minute - startMinute) * 60_000);
}

export async function POST(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  if (!getVisitorToken(request)) return contractError(request, "SESSION_TOKEN_REQUIRED", "يلزم رمز جلسة الزيارة.", 401);

  const session = await resolveVisitorSession(eventSlug, request);
  if (!session) return contractError(request, "SESSION_NOT_FOUND", "جلسة الزيارة غير موجودة أو انتهت.", 404);
  const rate = await enforceRateLimit(request, { scope: `itinerary:create:${eventSlug}:${session.id}`, limit: 10 });
  if (!rate.allowed) {
    const response = contractError(request, "RATE_LIMITED", "تم تجاوز عدد طلبات بناء المسار. حاول بعد قليل.", 429);
    response.headers.set("retry-after", String(rate.retryAfterSeconds));
    return response;
  }

  const parsed = itineraryRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return contractError(request, "INVALID_REQUEST", "بيانات المسار غير صالحة.", 400, parsed.error.flatten());
  }

  const catalogResult = await loadSessionCatalog(eventSlug, session.catalogVersionId);
  if (!catalogResult || catalogResult.catalogVersionId !== session.catalogVersionId) {
    return contractError(request, "CATALOG_VERSION_UNAVAILABLE", "نسخة الكتالوج المرتبطة بالجلسة غير متاحة.", 409);
  }

  const preferenceInput = parsed.data.preferences ?? session.preferences;
  const clock = getEventClock({
    eventSlug,
    startsAt: catalogResult.eventStartsAt,
    endsAt: catalogResult.eventEndsAt,
    timezone: catalogResult.venueTimezone,
    openingFrom: catalogResult.catalog.site.opening.from,
    openingTo: catalogResult.catalog.site.opening.to,
  });
  const visit = resolveVisitWindow(catalogResult.catalog, preferenceInput, clock.nowMinute);
  const profile = visit.profile;
  const live = await activeLiveEvents(session.eventId, session.catalogVersionId, new Date(), visit.effectiveNowMinute);
  profile.avoid = live.events.flatMap((event) => event.type === "cancel" ? [event.activity] : []);
  const site = new Site(catalogResult.catalog);
  site.applyEvents(live.events, visit.effectiveNowMinute);
  const computed = buildRoute(site, profile);
  const stableKeys = computed.stops.map((stop) => stop.act_id);
  const activityRows = await prisma.activity.findMany({
    where: { catalogVersionId: session.catalogVersionId, stableKey: { in: stableKeys } },
    select: { id: true, stableKey: true },
  });
  const dbActivityIds = new Map(activityRows.map((activity) => [activity.stableKey, activity.id]));
  if (activityRows.length !== stableKeys.length) {
    return contractError(request, "CATALOG_INCOMPLETE", "بعض أنشطة المسار غير موجودة في نسخة الكتالوج المنشورة.", 409);
  }

  const idempotency = await beginIdempotency(request, {
    sessionId: session.id,
    scope: "itinerary.create",
    payload: parsed.data,
  });
  if (idempotency.kind === "replay") return replayIdempotentResponse(request, idempotency.body, idempotency.statusCode);
  const idempotencyFailure = idempotencyErrorResponse(request, idempotency);
  if (idempotencyFailure) return idempotencyFailure;
  const idempotencyRecordId = idempotency.kind === "proceed" ? idempotency.recordId : null;

  const base = new Date();
  const stored = await prisma.$transaction(async (tx) => {
    await tx.visitorPreference.upsert({
      where: { sessionId: session.id },
      update: {
        companions: preferenceInput?.companions ?? undefined,
        partySize: preferenceInput?.partySize ?? undefined,
        youngestChildAge: preferenceInput?.youngestChildAge ?? undefined,
        mood: preferenceInput?.mood ?? undefined,
        interests: preferenceInput?.interests ?? undefined,
        budgetMaxCents: preferenceInput?.budgetMaxCents ?? undefined,
        availableMinutes: preferenceInput?.availableMinutes ?? undefined,
        walkingTolerance: preferenceInput?.walkingTolerance ?? undefined,
        startPointId: preferenceInput?.startPointId ?? undefined,
        startMinute: visit.effectiveNowMinute,
      },
      create: {
        sessionId: session.id,
        companions: preferenceInput?.companions ?? undefined,
        partySize: preferenceInput?.partySize ?? undefined,
        youngestChildAge: preferenceInput?.youngestChildAge ?? undefined,
        mood: preferenceInput?.mood ?? undefined,
        interests: preferenceInput?.interests ?? [],
        budgetMaxCents: preferenceInput?.budgetMaxCents ?? undefined,
        availableMinutes: preferenceInput?.availableMinutes ?? undefined,
        walkingTolerance: preferenceInput?.walkingTolerance ?? undefined,
        startPointId: preferenceInput?.startPointId ?? undefined,
        startMinute: visit.effectiveNowMinute,
      },
    });

    const itinerary = await tx.itinerary.create({
      data: {
        sessionId: session.id,
        eventId: session.eventId,
        catalogVersionId: session.catalogVersionId,
        generatedReason: parsed.data.generatedReason ?? "visitor_preferences",
        totalCostCents: Math.round(computed.total_cost * 100),
        totalWalkMin: computed.stops.reduce((sum, stop) => sum + stop.walk_min, 0),
        totalWaitMin: computed.stops.reduce((sum, stop) => sum + stop.wait_min, 0),
        items: {
          create: computed.stops.map((stop, index) => ({
            activityId: dbActivityIds.get(stop.act_id)!,
            sequence: index,
            startsAt: dateForPlanMinute(base, profile.start_min, stop.start),
            endsAt: dateForPlanMinute(base, profile.start_min, stop.end),
            walkMin: stop.walk_min,
            waitMin: stop.wait_min,
            score: computed.score,
            reasonCodes: stop.note ? [stop.note] : [],
            sourceRefs: [`catalog:${session.catalogVersionId}`],
          })),
        },
      },
      include: { items: { include: { activity: true } } },
    });
    await tx.itinerary.updateMany({
      where: { sessionId: session.id, eventId: session.eventId, status: "proposed" },
      data: { status: "dismissed", decisionAt: new Date() },
    });
    await tx.itinerary.updateMany({
      where: { sessionId: session.id, eventId: session.eventId, status: "active", id: { not: itinerary.id } },
      data: { status: "superseded" },
    });
    return itinerary;
  });

  await prisma.visitorSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  // سجل ما زاره الضيف في ملفه (اختياري — فشله لا يؤثر على المسار)
  if (session.guestProfile?.id) {
    const { recordVisitedKeys } = await import("@/lib/guest-session");
    await recordVisitedKeys(session.guestProfile.id, stableKeys).catch(() => {});
  }
  const payload = {
    itineraryId: stored.id,
    sessionId: session.id,
    catalogVersionId: session.catalogVersionId,
    profile,
    itinerary: computed,
    itineraryItems: stored.items,
    nowText: fmtTime(profile.start_min),
    clock,
  };
  const meta = { persistence: "postgresql", generatedAt: stored.generatedAt.toISOString() };
  if (idempotencyRecordId) await completeIdempotency(idempotencyRecordId, 201, { data: payload, meta });
  return jsonData(request, payload, meta, { status: 201 });
}

export async function GET(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  if (!getVisitorToken(request)) return contractError(request, "SESSION_TOKEN_REQUIRED", "يلزم رمز جلسة الزيارة.", 401);
  const session = await resolveVisitorSession(eventSlug, request);
  if (!session) return contractError(request, "SESSION_NOT_FOUND", "جلسة الزيارة غير موجودة أو انتهت.", 404);
  const catalogResult = await loadSessionCatalog(eventSlug, session.catalogVersionId);
  if (!catalogResult || catalogResult.catalogVersionId !== session.catalogVersionId) return contractError(request, "CATALOG_VERSION_UNAVAILABLE", "نسخة الكتالوج المرتبطة بالجلسة غير متاحة.", 409);
  const clock = getEventClock({
    eventSlug,
    startsAt: catalogResult.eventStartsAt,
    endsAt: catalogResult.eventEndsAt,
    timezone: catalogResult.venueTimezone,
    openingFrom: catalogResult.catalog.site.opening.from,
    openingTo: catalogResult.catalog.site.opening.to,
  });
  const visit = resolveVisitWindow(catalogResult.catalog, session.preferences, clock.nowMinute);
  const profile = visit.profile;
  const stored = await prisma.itinerary.findFirst({
    where: { sessionId: session.id, eventId: session.eventId, status: "active" },
    orderBy: { generatedAt: "desc" },
    include: { items: { orderBy: { sequence: "asc" }, include: { activity: true } } },
  });
  const itinerary = stored ? toEngineItinerary(stored as unknown as StoredItinerary, catalogResult.catalog, profile) : null;
  return jsonData(request, {
      itineraryId: stored?.id ?? null,
      sessionId: session.id,
      profile,
      itinerary,
      itineraryItems: stored?.items ?? [],
      nowText: fmtTime(clock.nowMinute),
      clock,
    }, { persistence: "postgresql", catalogVersionId: session.catalogVersionId });
}
