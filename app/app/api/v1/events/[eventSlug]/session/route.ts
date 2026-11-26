import { prisma } from "@/lib/db";
import { loadPublishedEventCatalog } from "@/lib/db-catalog";
import { createVisitorSessionSchema } from "@/lib/api-contracts";
import { clearVisitorCookie, createVisitorToken, hashVisitorToken, readVisitorToken, setVisitorCookie } from "@/lib/public-session";
import { createGuestToken, ensureGuestProfileWithPreferences, readGuestToken, setGuestCookie } from "@/lib/guest-session";
import { getEventClock } from "@/lib/event-clock";
import { PITCH_EVENT_SLUG } from "../../../../../../../packages/contracts/src/index.ts";
import { enforceRateLimit } from "@/lib/rate-limit";
import { FEATURE_FLAGS, getPublicFeatureFlags, isFeatureEnabled } from "@/lib/feature-flags";
import { jsonData, jsonError } from "@/lib/api-response";
import { abandonIdempotency, beginIdempotency, idempotencyErrorResponse, replayIdempotentResponse } from "@/lib/idempotency";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

export async function POST(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  const rate = await enforceRateLimit(request, { scope: `session:create:${eventSlug}`, limit: 20 });
  if (!rate.allowed) {
    const response = jsonError(request, "RATE_LIMITED", "تم تجاوز عدد محاولات بدء الزيارة. حاول بعد قليل.", 429);
    response.headers.set("retry-after", String(rate.retryAfterSeconds));
    return response;
  }
  const parsed = createVisitorSessionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError(request, "INVALID_REQUEST", "بيانات بدء الزيارة غير صالحة.", 400, parsed.error.flatten());
  }

  const catalog = await loadPublishedEventCatalog(eventSlug);
  if (!catalog) {
    return jsonError(request, "EVENT_UNAVAILABLE", "الفعالية غير متاحة من مصدر البيانات المنشور حاليًا.", 503);
  }

  const idempotency = await beginIdempotency(request, {
    eventId: catalog.eventId,
    scope: `session:create:${eventSlug}`,
    payload: parsed.data,
  });
  if (idempotency.kind === "replay") {
    const replayData = idempotency.body.data as { sessionId?: string; authMode?: string; expiresAt?: string };
    const response = replayIdempotentResponse(request, idempotency.body, idempotency.statusCode);
    // A cookie session cannot return its original secret from the database. Rotate the
    // cookie on a replay while keeping the original session and stored response stable.
    if (replayData.authMode === "cookie" && replayData.sessionId) {
      const replaySession = await prisma.visitorSession.findFirst({
        where: { id: replayData.sessionId, eventId: catalog.eventId, deletedAt: null },
        select: { id: true, expiresAt: true },
      });
      if (replaySession) {
        const replayToken = createVisitorToken();
        await prisma.visitorSession.update({ where: { id: replaySession.id }, data: { publicTokenHash: hashVisitorToken(replayToken), lastSeenAt: new Date() } });
        setVisitorCookie(response, replayToken, replaySession.expiresAt);
      }
    }
    return response;
  }
  const idempotencyFailure = idempotencyErrorResponse(request, idempotency);
  if (idempotencyFailure) return idempotencyFailure;
  const idempotencyRecordId = idempotency.kind === "proceed" ? idempotency.recordId : null;

  const token = createVisitorToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const clock = getEventClock({
    eventSlug,
    startsAt: catalog.eventStartsAt,
    endsAt: catalog.eventEndsAt,
    timezone: catalog.venueTimezone,
    openingFrom: catalog.catalog.site.opening.from,
    openingTo: catalog.catalog.site.opening.to,
  });
  const preferences = parsed.data.preferences
    ? { ...parsed.data.preferences, startMinute: clock.nowMinute }
    : undefined;
  const useCookieSession = parsed.data.clientType === "web" && isFeatureEnabled(FEATURE_FLAGS.browserCookieSession);
  // Cross-visit preferences require explicit consent and are disabled in the rehearsal.
  const optInPersist = eventSlug !== PITCH_EVENT_SLUG && parsed.data.preferences?.optInPersist === true;
  let guestProfileId: string | null = null;
  let guestToken: string | null = null;
  if (useCookieSession && optInPersist && process.env.DATABASE_URL) {
    try {
      guestToken = readGuestToken(request) ?? createGuestToken();
      guestProfileId = await ensureGuestProfileWithPreferences(guestToken, parsed.data.preferences);
    } catch {
      // ملف الضيف تحسين اختياري — فشله لا يعطّل بدء الزيارة
      guestToken = null;
      guestProfileId = null;
    }
  }
  try {
    const result = await prisma.$transaction(async (tx) => {
      const session = await tx.visitorSession.create({
        data: {
          publicTokenHash: hashVisitorToken(token),
          eventId: catalog.eventId,
          catalogVersionId: catalog.catalogVersionId,
          locale: parsed.data.locale,
          entryPoint: parsed.data.entryPoint,
          consentState: parsed.data.consentState as any,
          expiresAt,
          guestProfileId: guestProfileId ?? undefined,
          preferences: preferences
            ? { create: preferences }
            : undefined,
        },
        include: { preferences: true },
      });
      const data = {
        sessionId: session.id,
        ...(!useCookieSession ? { token } : {}),
        authMode: useCookieSession ? "cookie" : "bearer",
        eventSlug,
        catalogVersionId: session.catalogVersionId,
        expiresAt: session.expiresAt.toISOString(),
        preferences: session.preferences,
        personalized: Boolean(guestProfileId),
        clock,
      };
      const meta = { persistence: "postgresql", features: getPublicFeatureFlags() };
      if (idempotencyRecordId) {
        await tx.idempotencyRecord.update({
          where: { id: idempotencyRecordId },
          data: { status: "completed", statusCode: 201, responseBody: { data, meta } as any, completedAt: new Date() },
        });
      }
      return { data, meta, expiresAt: session.expiresAt };
    });
    const response = jsonData(request, result.data, result.meta, { status: 201 });
    if (useCookieSession) setVisitorCookie(response, token, result.expiresAt);
    if (useCookieSession && guestToken) setGuestCookie(response, guestToken);
    return response;
  } catch (error) {
    if (idempotencyRecordId) await abandonIdempotency(idempotencyRecordId);
    throw error;
  }
}
export async function GET(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  const token = readVisitorToken(request);
  if (!token) {
    return jsonError(request, "SESSION_TOKEN_REQUIRED", "يلزم رمز جلسة الزيارة.", 401);
  }

  if (!process.env.DATABASE_URL) {
    return jsonError(request, "DATABASE_UNAVAILABLE", "جلسات الزيارة الدائمة غير مفعلة في هذا التشغيل.", 503);
  }

  const session = await prisma.visitorSession.findFirst({
    where: {
      publicTokenHash: hashVisitorToken(token),
      deletedAt: null,
      expiresAt: { gt: new Date() },
      event: { slug: eventSlug },
    },
    include: { event: true, preferences: true },
  });
  if (!session) {
    return jsonError(request, "SESSION_NOT_FOUND", "جلسة الزيارة غير موجودة أو انتهت.", 404);
  }

  await prisma.visitorSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  return jsonData(request, {
      sessionId: session.id,
      eventSlug: session.event.slug,
      eventName: session.event.name,
      catalogVersionId: session.catalogVersionId,
      locale: session.locale,
      expiresAt: session.expiresAt.toISOString(),
      preferences: session.preferences,
    }, { persistence: "postgresql", features: getPublicFeatureFlags() });
}

export async function DELETE(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  const token = readVisitorToken(request);
  if (token && process.env.DATABASE_URL) {
    await prisma.visitorSession.deleteMany({
      where: { publicTokenHash: hashVisitorToken(token), event: { slug: eventSlug } },
    });
  }
  const response = jsonData(request, { deleted: true }, { persistence: process.env.DATABASE_URL ? "postgresql" : "json-fallback" });
  clearVisitorCookie(response);
  return response;
}
