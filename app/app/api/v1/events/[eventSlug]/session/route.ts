import { z } from "zod";
import { prisma } from "@/lib/db";
import { loadPublishedEventCatalog } from "@/lib/db-catalog";
import { createVisitorSessionSchema } from "@/lib/api-contracts";
import { clearVisitorCookie, createVisitorToken, hashVisitorToken, readVisitorToken, setVisitorCookie } from "@/lib/public-session";
import { clearGuestCookie, createGuestToken, deleteGuestProfiles, ensureGuestProfileWithPreferences, findGuestProfile, readGuestToken, setGuestCookie, startGuestVisit } from "@/lib/guest-session";
import { getEventClock } from "@/lib/event-clock";
import { PITCH_EVENT_SLUG } from "../../../../../../../packages/contracts/src/index.ts";
import { enforceRateLimit } from "@/lib/rate-limit";
import { FEATURE_FLAGS, getPublicFeatureFlags, isFeatureEnabled } from "@/lib/feature-flags";
import { jsonData, jsonError } from "@/lib/api-response";
import { organizationIdForEvent, registrationRequired, rememberVisitorPreferences, resolveDeviceVisitor } from "@/lib/visitor-store";
import { abandonIdempotency, beginIdempotency, idempotencyErrorResponse, replayIdempotentResponse } from "@/lib/idempotency";
import { hashKioskToken, readKioskToken } from "@/lib/kiosk";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

export async function POST(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  // Audit 5.2: a kiosk signs in with its device token and is rate limited per screen, not per address.
  const kioskToken = readKioskToken(request);
  const kioskDevice = kioskToken && process.env.DATABASE_URL
    ? await prisma.kioskDevice.findFirst({
      where: { tokenHash: hashKioskToken(kioskToken), revokedAt: null, event: { slug: eventSlug } },
      select: { id: true, nodeKey: true },
    })
    : null;
  const rate = await enforceRateLimit(request, kioskDevice
    ? { scope: `session:kiosk:${kioskDevice.id}`, limit: 30 }
    : { scope: `session:create:${eventSlug}`, limit: 20 });
  if (!rate.allowed) {
    const response = jsonError(request, "RATE_LIMITED", "تم تجاوز عدد محاولات بدء الزيارة. حاول بعد قليل.", 429);
    response.headers.set("retry-after", String(rate.retryAfterSeconds));
    return response;
  }
  const parsed = createVisitorSessionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError(request, "INVALID_REQUEST", "بيانات بدء الزيارة غير صالحة.", 400, parsed.error.flatten());
  }
  const kiosk = parsed.data.clientType === "kiosk" ? kioskDevice : null;
  if (parsed.data.clientType === "kiosk" && !kiosk) {
    return jsonError(request, "KIOSK_TOKEN_INVALID", "هذه الشاشة غير مسجّلة أو أُوقفت. اطلب من المنظم رمز شاشة جديد.", 401);
  }

  const catalog = await loadPublishedEventCatalog(eventSlug);
  if (!catalog) {
    return jsonError(request, "EVENT_UNAVAILABLE", "الفعالية غير متاحة من مصدر البيانات المنشور حاليًا.", 503);
  }

  // Registered-visitor mode: a visit starts only for a visitor this device remembers (name + verified phone).
  let registered: Awaited<ReturnType<typeof resolveDeviceVisitor>> = null;
  // A kiosk visit is anonymous by design: no registration, no remembered guest.
  if (!kiosk && registrationRequired(eventSlug)) {
    const organizationId = await organizationIdForEvent(catalog.eventId);
    registered = organizationId ? await resolveDeviceVisitor(request, organizationId) : null;
    if (!registered) {
      return jsonError(request, "VISITOR_REGISTRATION_REQUIRED", "سجّل اسمك ورقم جوالك قبل بدء الزيارة.", 401);
    }
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
  const expiresAt = new Date(Date.now() + (kiosk ? 2 : 24) * 60 * 60 * 1000);
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
  let guestVisitCount = 0;
  let previouslyVisited: string[] = [];
  if (!kiosk && !registered && useCookieSession && eventSlug !== PITCH_EVENT_SLUG && process.env.DATABASE_URL) {
    try {
      const organizationId = await organizationIdForEvent(catalog.eventId);
      if (!organizationId) throw new Error("event has no organization");
      if (optInPersist) {
        guestToken = readGuestToken(request) ?? createGuestToken();
        guestProfileId = await ensureGuestProfileWithPreferences(guestToken, organizationId, parsed.data.preferences);
      } else {
        // A profile behind this browser's cookie exists only because the visitor ticked «تذكّرني» on an
        // earlier visit (audit 4.1); untick it in «أنا» and the profile and cookie go.
        const found = await findGuestProfile(request, organizationId);
        if (found.status === "found") guestProfileId = found.profile.id;
      }
      if (guestProfileId) {
        const started = await startGuestVisit(guestProfileId);
        guestVisitCount = started.visitCount;
        previouslyVisited = started.visitedKeys.slice(-200);
      }
    } catch {
      // ملف الضيف تحسين اختياري — فشله لا يعطّل بدء الزيارة
      guestToken = null;
      guestProfileId = null;
      guestVisitCount = 0;
      previouslyVisited = [];
    }
  }
  if (registered) previouslyVisited = registered.visitor.visitedKeys.slice(-200);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const visit = registered
        ? await tx.visitorVisit.create({
          data: {
            visitorId: registered.visitor.id,
            eventId: catalog.eventId,
            companions: parsed.data.preferences?.companions,
            partySize: parsed.data.preferences?.partySize ?? undefined,
          },
          select: { id: true },
        })
        : null;
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
          previouslyVisited,
          ...(kiosk ? { channel: "kiosk", kioskDeviceId: kiosk.id } : {}),
          visitorId: registered?.visitor.id,
          visitorVisitId: visit?.id,
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
        personalized: Boolean(guestProfileId || registered),
        registered: Boolean(registered),
        remembered: Boolean(guestProfileId),
        channel: kiosk ? "kiosk" : "web",
        ...(guestProfileId ? { visitCount: guestVisitCount } : {}),
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
    if (registered && parsed.data.preferences) await rememberVisitorPreferences(registered.visitor.id, parsed.data.preferences).catch(() => {});
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
    include: { event: true, preferences: true, guestProfile: { select: { visitCount: true, deletedAt: true } } },
  });
  if (!session) {
    return jsonError(request, "SESSION_NOT_FOUND", "جلسة الزيارة غير موجودة أو انتهت.", 404);
  }
  const remembered = Boolean(session.guestProfile && !session.guestProfile.deletedAt);

  await prisma.visitorSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  return jsonData(request, {
      sessionId: session.id,
      eventSlug: session.event.slug,
      eventName: session.event.name,
      catalogVersionId: session.catalogVersionId,
      locale: session.locale,
      expiresAt: session.expiresAt.toISOString(),
      preferences: session.preferences,
      channel: session.channel,
      remembered,
      visitCount: remembered ? session.guestProfile!.visitCount : 0,
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

const sessionPatchSchema = z.object({
  // «أنا» (audit 2.2): the visitor picks the reply language; Saudi Arabic by default.
  replyLanguage: z.enum(["ar", "en", "fr", "ur"]).optional(),
  // «تذكّرني للزيارة الجاية» (audit 4.1): unticked by default. No name or phone, only an anonymous cookie.
  rememberMe: z.boolean().optional(),
}).strict().refine((body) => body.replyLanguage !== undefined || body.rememberMe !== undefined);

export async function PATCH(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  const token = readVisitorToken(request);
  if (!token) return jsonError(request, "SESSION_TOKEN_REQUIRED", "يلزم رمز جلسة الزيارة.", 401);
  if (!process.env.DATABASE_URL) return jsonError(request, "DATABASE_UNAVAILABLE", "جلسات الزيارة الدائمة غير مفعلة في هذا التشغيل.", 503);
  const parsed = sessionPatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(request, "INVALID_REQUEST", "اختر لغة مدعومة.", 400, { field: "replyLanguage" });
  const session = await prisma.visitorSession.findFirst({
    where: { publicTokenHash: hashVisitorToken(token), deletedAt: null, expiresAt: { gt: new Date() }, event: { slug: eventSlug } },
    select: { id: true, eventId: true, channel: true, visitorId: true, guestProfileId: true, preferences: true, itineraries: { select: { items: { select: { activity: { select: { stableKey: true } } } } } } },
  });
  if (!session) return jsonError(request, "SESSION_NOT_FOUND", "جلسة الزيارة غير موجودة أو انتهت.", 404);
  const out: { replyLanguage?: string | null; remembered?: boolean } = {};
  if (parsed.data.replyLanguage) {
    const preferences = await prisma.visitorPreference.upsert({
      where: { sessionId: session.id },
      update: { replyLanguage: parsed.data.replyLanguage },
      create: { sessionId: session.id, interests: [], replyLanguage: parsed.data.replyLanguage },
    });
    out.replyLanguage = preferences.replyLanguage;
  }
  let setCookie: string | null = null;
  let clearCookie = false;
  if (parsed.data.rememberMe !== undefined) {
    if (eventSlug === PITCH_EVENT_SLUG || session.channel !== "web" || session.visitorId) {
      return jsonError(request, "REMEMBER_UNAVAILABLE", "التذكّر متاح لزيارة الويب المجهولة فقط.", 409);
    }
    const organizationId = await organizationIdForEvent(session.eventId);
    if (!organizationId) return jsonError(request, "EVENT_UNAVAILABLE", "الفعالية غير متاحة حاليًا.", 503);
    if (parsed.data.rememberMe) {
      const guestToken = readGuestToken(request) ?? createGuestToken();
      const profileId = await ensureGuestProfileWithPreferences(guestToken, organizationId, session.preferences);
      const { recordVisitedKeys } = await import("@/lib/guest-session");
      const planned = session.itineraries.flatMap((itinerary) => itinerary.items.map((item) => item.activity.stableKey));
      await prisma.visitorSession.update({ where: { id: session.id }, data: { guestProfileId: profileId } });
      // This visit counts as the first one; what is already planned counts as seen.
      if (!session.guestProfileId) await startGuestVisit(profileId);
      await recordVisitedKeys(profileId, planned).catch(() => {});
      setCookie = guestToken;
    } else {
      const guestToken = readGuestToken(request);
      // The session keeps going; its guestProfileId is set to null by the foreign key.
      if (guestToken) await deleteGuestProfiles(guestToken);
      clearCookie = true;
    }
    out.remembered = parsed.data.rememberMe;
  }
  const response = jsonData(request, out, { persistence: "postgresql" });
  if (setCookie) setGuestCookie(response, setCookie);
  if (clearCookie) clearGuestCookie(response);
  return response;
}
