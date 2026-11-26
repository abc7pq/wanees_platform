import { calculateCrowdObservation } from "../../../../../../../packages/engine/src/crowd-observation.ts";
import { PITCH_EVENT_SLUG, PITCH_ORGANIZATION_SLUG } from "../../../../../../../packages/contracts/src/index.ts";
import { NextResponse } from "next/server";
import { checkAuth, checkAuthAsync } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { findOrganizerSession } from "@/lib/organizer-auth";
import { enforceAdminRateLimit, isSameOrigin } from "@/lib/request-security";
import { authorizeEventRequest } from "@/lib/catalog-auth";
import { abandonAdminIdempotency, adminIdempotencyFailure, beginAdminIdempotency, completeAdminIdempotency, replayAdminIdempotency } from "@/lib/idempotency";
import { withAdminApiContract } from "@/lib/api-response";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };
const updateTypes = new Set(["CLOSURE", "DELAY", "SCHEDULE_CHANGE", "CROWD_OVERRIDE", "CONTENT_CORRECTION"]);
const targetTypes = new Set(["event", "zone", "activity"]);

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseDate(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

const updateReaders = ["OWNER", "ADMIN", "OPERATOR", "ANALYST", "VIEWER"] as const;

function updateStatus(update: { revokedAt: Date | null; startsAt: Date | null; endsAt: Date | null }, now: Date) {
  if (update.revokedAt) return "REVOKED";
  if (update.endsAt && update.endsAt < now) return "EXPIRED";
  if (update.startsAt && update.startsAt > now) return "SCHEDULED";
  return "ACTIVE";
}

export const GET = withAdminApiContract(async function GET(request: Request, context: Context) {
  if (!process.env.DATABASE_URL) return errorResponse("DATABASE_UNAVAILABLE", "قاعدة البيانات غير مفعلة.", 503);
  const { eventSlug } = await context.params;
  const access = await authorizeEventRequest(request, eventSlug, [...updateReaders]);
  if (!access.authorized) {
    return errorResponse(access.userId ? "FORBIDDEN" : "UNAUTHORIZED", "صلاحية المشغّل مطلوبة لعرض التحديثات.", access.userId ? 403 : 401);
  }
  if (!access.event) return errorResponse("EVENT_NOT_FOUND", "الفعالية غير موجودة ضمن المنظمة الحالية.", 404);

  const url = new URL(request.url);
  const view = url.searchParams.get("view") ?? "active";
  if (view !== "active" && view !== "history") return errorResponse("INVALID_REQUEST", "قيمة view يجب أن تكون active أو history.", 400);
  const now = new Date();
  const rows = await prisma.eventUpdate.findMany({
    where: view === "active"
      ? { eventId: access.event.id, revokedAt: null, OR: [{ endsAt: null }, { endsAt: { gte: now } }] }
      : { eventId: access.event.id, OR: [{ revokedAt: { not: null } }, { endsAt: { lt: now } }] },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
    include: { revokedByUser: { select: { id: true, displayName: true } } },
  });

  return NextResponse.json({
    data: rows.map((row) => ({
      id: row.id,
      updateType: row.updateType,
      targetType: row.targetType,
      targetId: row.targetId,
      payload: row.payload,
      startsAt: row.startsAt?.toISOString() ?? null,
      endsAt: row.endsAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      status: updateStatus(row, now),
      revokedAt: row.revokedAt?.toISOString() ?? null,
      revokedBy: row.revokedByUser ? { id: row.revokedByUser.id, displayName: row.revokedByUser.displayName } : null,
      revocationReason: row.revocationReason,
    })),
    meta: { persistence: "postgresql", view, limit: 100 },
  });
});

export const POST = withAdminApiContract(async function POST(request: Request, context: Context) {
  if (!isSameOrigin(request)) return errorResponse("FORBIDDEN", "الطلب غير صادر من مصدر موثوق.", 403);
  const rate = await enforceAdminRateLimit(request, "event-update", 120);
  if (!rate.allowed) {
    const response = errorResponse("RATE_LIMITED", "تم تجاوز عدد التحديثات التشغيلية. حاول بعد قليل.", 429);
    response.headers.set("retry-after", String(rate.retryAfterSeconds));
    return response;
  }
  if (!(await checkAuthAsync(request))) return errorResponse("UNAUTHORIZED", "غير مصرح.", 401);
  if (!process.env.DATABASE_URL) return errorResponse("DATABASE_UNAVAILABLE", "قاعدة البيانات غير مفعلة.", 503);

  const legacyAuth = checkAuth(request);
  const durableSession = legacyAuth ? null : await findOrganizerSession(request);
  const operatorMembership = durableSession?.user.memberships.find((membership) =>
    membership.organization.status === "ACTIVE" && ["OWNER", "ADMIN", "OPERATOR"].includes(membership.role),
  );
  if (!legacyAuth && !operatorMembership) return errorResponse("FORBIDDEN", "صلاحية المشغّل مطلوبة لهذا التحديث.", 403);

  const { eventSlug } = await context.params;
  const body = await request.json().catch(() => null);
  if (!isRecord(body)) return errorResponse("INVALID_REQUEST", "بيانات التحديث غير صالحة.", 400);

  const updateType = typeof body.updateType === "string" ? body.updateType : "";
  const targetType = typeof body.targetType === "string" ? body.targetType : "";
  const targetId = typeof body.targetId === "string" && body.targetId.trim() ? body.targetId.trim() : null;
  const payload = isRecord(body.payload) ? { ...body.payload } : {};
  const parsedStartsAt = parseDate(body.startsAt);
  const parsedEndsAt = parseDate(body.endsAt);
  const startsAt = parsedStartsAt === null ? new Date() : parsedStartsAt;
  const endsAt = parsedEndsAt === null ? null : parsedEndsAt;
  if (!updateTypes.has(updateType) || !targetTypes.has(targetType) || startsAt === undefined || endsAt === undefined) {
    return errorResponse("INVALID_REQUEST", "نوع التحديث والهدف والتواريخ غير صالحة.", 400);
  }
  if (startsAt && endsAt && endsAt <= startsAt) {
    return errorResponse("INVALID_REQUEST", "يجب أن يكون وقت الانتهاء بعد وقت البدء.", 400);
  }
  if (updateType === "CROWD_OVERRIDE" && targetType !== "zone") {
    return errorResponse("INVALID_TARGET", "تحديث الزحام يجب أن يستهدف منطقة.", 400);
  }
  if (updateType === "CROWD_OVERRIDE" && payload.measurement !== "counted" && typeof payload.level !== "number") {
    return errorResponse("INVALID_PAYLOAD", "تحديث الزحام يحتاج level بين 0 و1.", 400);
  }
  if (typeof payload.level === "number" && (payload.level < 0 || payload.level > 1)) {
    return errorResponse("INVALID_PAYLOAD", "مستوى الزحام يجب أن يكون بين 0 و1.", 400);
  }
  if (updateType === "DELAY" && (targetType !== "activity" || typeof payload.minutes !== "number" || !Number.isInteger(payload.minutes) || payload.minutes < 1 || payload.minutes > 240)) {
    return errorResponse("INVALID_PAYLOAD", "اختر نشاطًا وحدد تأخيرًا بين دقيقة و240 دقيقة.", 400);
  }
  if (payload.reason !== undefined) {
    if (typeof payload.reason !== "string" || !payload.reason.trim() || payload.reason.length > 200) {
      return errorResponse("INVALID_PAYLOAD", "اكتب سببًا بين حرف واحد و200 حرف.", 400);
    }
    payload.reason = payload.reason.trim();
  }
  if ((targetType === "zone" || targetType === "activity") && !targetId) {
    return errorResponse("INVALID_TARGET", "يلزم معرف المنطقة أو النشاط.", 400);
  }

  const organizationSlug = operatorMembership?.organization.slug ?? process.env.WANEES_ORGANIZATION_SLUG ?? "wanees-demo";
  const event = await prisma.event.findFirst({
    where: { slug: eventSlug, organization: { slug: organizationSlug } },
    select: { id: true, organizationId: true, publishedCatalogVersionId: true },
  });
  if (!event) return errorResponse("EVENT_NOT_FOUND", "الفعالية غير موجودة ضمن المنظمة الحالية.", 404);
  if (!event.publishedCatalogVersionId) return errorResponse("CATALOG_UNAVAILABLE", "لا يوجد كتالوج منشور لهذه الفعالية.", 409);

  let zoneId: string | null = null;
  let storedPayload = payload;
  if (targetType === "zone") {
    const zone = await prisma.zone.findFirst({
      where: { catalogVersionId: event.publishedCatalogVersionId, stableKey: targetId! },
      select: { id: true, capacity: true, sourceRefs: true },
    });
    if (!zone) return errorResponse("TARGET_NOT_FOUND", "المنطقة غير موجودة في الكتالوج المنشور.", 404);
    zoneId = zone.id;
    if (updateType === "CROWD_OVERRIDE") {
      if (payload.measurement === "counted") {
        const rehearsal = eventSlug === PITCH_EVENT_SLUG && organizationSlug === PITCH_ORGANIZATION_SLUG;
        const approved = rehearsal || await prisma.contentSource.findFirst({
          where: {
            catalogVersionId: event.publishedCatalogVersionId,
            id: { in: zone.sourceRefs },
            sourceType: "operator_capacity",
            reviewStatus: "VERIFIED",
            OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }],
          },
          select: { id: true },
        });
        if (!approved) return errorResponse("INVALID_PAYLOAD", "اعتمد سعة المنطقة في الكتالوج المنشور أولًا.", 400);
        const observation = calculateCrowdObservation(payload.occupiedPeople, zone.capacity, payload.waitMinutes);
        if (!observation || !endsAt || endsAt.getTime() - startsAt.getTime() > 60 * 60_000) {
          return errorResponse("INVALID_PAYLOAD", "القياس يحتاج عددًا صالحًا وسعة منشورة ووقت سريان لا يزيد على ساعة.", 400);
        }
        storedPayload = { ...observation };
      } else {
        storedPayload = { ...payload, measurement: "estimated" };
      }
    }
  }
  if (targetType === "activity") {
    const activity = await prisma.activity.findFirst({
      where: { catalogVersionId: event.publishedCatalogVersionId, stableKey: targetId! },
      select: { id: true },
    });
    if (!activity) return errorResponse("TARGET_NOT_FOUND", "النشاط غير موجود في الكتالوج المنشور.", 404);
  }

  const idempotency = await beginAdminIdempotency(request, {
    eventId: event.id,
    scope: "event-update.create",
    payload: { updateType, targetType, targetId, payload: storedPayload, startsAt: startsAt?.toISOString() ?? null, endsAt: endsAt?.toISOString() ?? null },
  });
  if (idempotency.kind === "replay") return replayAdminIdempotency(idempotency);
  const idempotencyFailure = adminIdempotencyFailure(idempotency);
  if (idempotencyFailure) return errorResponse(idempotencyFailure.code, idempotencyFailure.message, idempotencyFailure.status);
  const idempotencyRecordId = idempotency.kind === "proceed" ? idempotency.recordId : null;

  const crowdExpiresAt = endsAt ?? new Date(Date.now() + 15 * 60_000);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const update = await tx.eventUpdate.create({
        data: {
          eventId: event.id,
          actorUserId: durableSession?.user.id ?? undefined,
          updateType: updateType as any,
          targetType,
          targetId,
          payload: storedPayload as any,
          startsAt,
          endsAt,
        },
      });
      let crowdSnapshot = null;
      if (updateType === "CROWD_OVERRIDE" && zoneId) {
        crowdSnapshot = await tx.crowdSnapshot.create({
          data: {
            eventId: event.id,
            eventUpdateId: update.id,
            zoneId,
            level: storedPayload.level as number,
            source: "OPERATOR" as any,
            confidence: storedPayload.measurement === "counted" ? 1 : 0.6,
            observedAt: new Date(),
            expiresAt: crowdExpiresAt,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          organizationId: event.organizationId,
          actorUserId: durableSession?.user.id ?? undefined,
          action: "event_update.create",
          entityType: "EventUpdate",
          entityId: update.id,
          afterSummary: { updateType, targetType, targetId, payload: storedPayload } as any,
        },
      });
      return { update, crowdSnapshot };
    });

    const data = {
      update: {
        id: result.update.id,
        updateType: result.update.updateType,
        targetType: result.update.targetType,
        targetId: result.update.targetId,
        payload: result.update.payload,
        startsAt: result.update.startsAt?.toISOString() ?? null,
        endsAt: result.update.endsAt?.toISOString() ?? null,
      },
      crowdSnapshot: result.crowdSnapshot
        ? { id: result.crowdSnapshot.id, level: result.crowdSnapshot.level, expiresAt: result.crowdSnapshot.expiresAt?.toISOString() ?? null }
        : null,
    };
    const meta = { persistence: "postgresql", source: "operator" };
    if (idempotencyRecordId) await completeAdminIdempotency(idempotencyRecordId, 201, { data, meta });
    return NextResponse.json({ data, meta }, { status: 201 });
  } catch (error) {
    if (idempotencyRecordId) await abandonAdminIdempotency(idempotencyRecordId);
    throw error;
  }
});
