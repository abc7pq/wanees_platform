import { NextResponse } from "next/server";
import { checkAuth, checkAuthAsync } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { findOrganizerSession } from "@/lib/organizer-auth";
import { enforceAdminRateLimit, isSameOrigin } from "@/lib/request-security";
import { authorizeEventRequest } from "@/lib/catalog-auth";
import { withAdminApiContract } from "@/lib/api-response";
import { abandonAdminIdempotency, adminIdempotencyFailure, beginAdminIdempotency, completeAdminIdempotency, replayAdminIdempotency } from "@/lib/idempotency";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string; incentiveId: string }> };

const KINDS = new Set(["FREE_ITEM", "DISCOUNT", "PRIORITY_ENTRY", "FREE_ACTIVITY", "CREDIT"]);
const TRIGGERS = new Set(["CLOSURE", "DELAY", "SCHEDULE_CHANGE", "CROWD_OVERRIDE"]);
const SCOPE_TARGETS = new Set(["EVENT", "ZONE", "ACTIVITY"]);

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseDate(value: unknown): Date | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseOptionalInt(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
  return value;
}

function parseOptionalLevel(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || value < 0 || value > 1) return undefined;
  return value;
}

function view(row: {
  id: string;
  kind: string;
  titleAr: string;
  valueLabelAr: string;
  reasonAr: string;
  valueCents: number;
  priority: number;
  trigger: string | null;
  scopeTarget: string | null;
  scopeKey: string | null;
  minCrowdLevel: number | null;
  redirectZoneKey: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  perVisitorCap: number;
  locationLabelAr: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count: { claims: number };
}) {
  return {
    id: row.id,
    kind: row.kind,
    titleAr: row.titleAr,
    valueLabelAr: row.valueLabelAr,
    reasonAr: row.reasonAr,
    valueCents: row.valueCents,
    priority: row.priority,
    trigger: row.trigger,
    scopeTarget: row.scopeTarget,
    scopeKey: row.scopeKey,
    minCrowdLevel: row.minCrowdLevel,
    redirectZoneKey: row.redirectZoneKey,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    perVisitorCap: row.perVisitorCap,
    locationLabelAr: row.locationLabelAr,
    claimsCount: row._count.claims,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const GET = withAdminApiContract(async function GET(request: Request, context: Context) {
  if (!process.env.DATABASE_URL) return errorResponse("DATABASE_UNAVAILABLE", "قاعدة البيانات غير مفعلة.", 503);
  const { eventSlug, incentiveId } = await context.params;
  const access = await authorizeEventRequest(request, eventSlug, ["OWNER", "ADMIN", "OPERATOR", "ANALYST", "VIEWER"]);
  if (!access.authorized) {
    return errorResponse(access.userId ? "FORBIDDEN" : "UNAUTHORIZED", "صلاحية المشغّل مطلوبة لعرض الحافز.", access.userId ? 403 : 401);
  }
  if (!access.event) return errorResponse("EVENT_NOT_FOUND", "الفعالية غير موجودة ضمن المنظمة الحالية.", 404);

  const incentive = await prisma.incentive.findFirst({
    where: { id: incentiveId, eventId: access.event.id },
    include: { _count: { select: { claims: true } } },
  });
  if (!incentive) return errorResponse("INCENTIVE_NOT_FOUND", "الحافز غير موجود ضمن هذه الفعالية.", 404);

  return NextResponse.json({
    data: view(incentive as unknown as Parameters<typeof view>[0]),
    meta: { persistence: "postgresql" },
  });
});

export const PATCH = withAdminApiContract(async function PATCH(request: Request, context: Context) {
  if (!isSameOrigin(request)) return errorResponse("FORBIDDEN", "الطلب غير صادر من مصدر موثوق.", 403);
  const rate = await enforceAdminRateLimit(request, "incentive", 60);
  if (!rate.allowed) {
    const response = errorResponse("RATE_LIMITED", "تم تجاوز عدد تعديلات الحوافز. حاول بعد قليل.", 429);
    response.headers.set("retry-after", String(rate.retryAfterSeconds));
    return response;
  }
  if (!(await checkAuthAsync(request))) return errorResponse("UNAUTHORIZED", "غير مصرح.", 401);
  if (!process.env.DATABASE_URL) return errorResponse("DATABASE_UNAVAILABLE", "قاعدة البيانات غير مفعلة.", 503);

  const legacyAuth = checkAuth(request);
  const durableSession = legacyAuth ? null : await findOrganizerSession(request);
  const operatorMembership = durableSession?.user.memberships.find(
    (membership) => membership.organization.status === "ACTIVE" && ["OWNER", "ADMIN", "OPERATOR"].includes(membership.role),
  );
  if (!legacyAuth && !operatorMembership) return errorResponse("FORBIDDEN", "صلاحية المشغّل مطلوبة لتعديل الحوافز.", 403);

  const { eventSlug, incentiveId } = await context.params;
  const body = await request.json().catch(() => null);
  if (!isRecord(body)) return errorResponse("INVALID_REQUEST", "بيانات الحافز غير صالحة.", 400);

  const organizationSlug = operatorMembership?.organization.slug ?? process.env.WANEES_ORGANIZATION_SLUG ?? "wanees-demo";
  const event = await prisma.event.findFirst({
    where: { slug: eventSlug, organization: { slug: organizationSlug } },
    select: { id: true, organizationId: true, publishedCatalogVersionId: true },
  });
  if (!event) return errorResponse("EVENT_NOT_FOUND", "الفعالية غير موجودة ضمن المنظمة الحالية.", 404);

  const existing = await prisma.incentive.findFirst({ where: { id: incentiveId, eventId: event.id }, select: { id: true } });
  if (!existing) return errorResponse("INCENTIVE_NOT_FOUND", "الحافز غير موجود ضمن هذه الفعالية.", 404);

  const data: Record<string, unknown> = {};
  if (typeof body.kind === "string") {
    if (!KINDS.has(body.kind)) return errorResponse("INVALID_REQUEST", "نوع الحافز غير صالح.", 400);
    data.kind = body.kind;
  }
  if (typeof body.titleAr === "string") data.titleAr = body.titleAr.trim();
  if (typeof body.valueLabelAr === "string") data.valueLabelAr = body.valueLabelAr.trim();
  if (typeof body.reasonAr === "string") data.reasonAr = body.reasonAr.trim();
  if ("valueCents" in body) {
    const valueCents = parseOptionalInt(body.valueCents);
    if (valueCents === undefined || valueCents < 0) return errorResponse("INVALID_REQUEST", "سعر الحافز غير صالح.", 400);
    data.valueCents = valueCents;
  }
  if ("priority" in body) {
    const priority = parseOptionalInt(body.priority);
    if (priority === undefined) return errorResponse("INVALID_REQUEST", "الأولوية يجب أن تكون عددًا صحيحًا.", 400);
    data.priority = priority;
  }
  if ("trigger" in body) {
    const trigger = typeof body.trigger === "string" && TRIGGERS.has(body.trigger) ? body.trigger : null;
    if (body.trigger !== null && typeof body.trigger !== "string") return errorResponse("INVALID_REQUEST", "محفّز الحافز غير صالح.", 400);
    data.trigger = trigger;
  }
  if ("scopeTarget" in body) {
    const scopeTarget = typeof body.scopeTarget === "string" && SCOPE_TARGETS.has(body.scopeTarget) ? body.scopeTarget : null;
    if (body.scopeTarget !== null && typeof body.scopeTarget !== "string") return errorResponse("INVALID_REQUEST", "نطاق الحافز غير صالح.", 400);
    data.scopeTarget = scopeTarget;
  }
  if (typeof body.scopeKey === "string") data.scopeKey = body.scopeKey.trim() || null;
  if ("minCrowdLevel" in body) {
    const minCrowdLevel = parseOptionalLevel(body.minCrowdLevel);
    if (minCrowdLevel === undefined) return errorResponse("INVALID_REQUEST", "حد الزحام غير صالح.", 400);
    data.minCrowdLevel = minCrowdLevel ?? null;
  }
  if (typeof body.redirectZoneKey === "string") data.redirectZoneKey = body.redirectZoneKey.trim() || null;
  if ("startsAt" in body) {
    const startsAt = parseDate(body.startsAt);
    if (startsAt === undefined) return errorResponse("INVALID_REQUEST", "تاريخ البدء غير صالح.", 400);
    data.startsAt = startsAt;
  }
  if ("endsAt" in body) {
    const endsAt = parseDate(body.endsAt);
    if (endsAt === undefined) return errorResponse("INVALID_REQUEST", "تاريخ الانتهاء غير صالح.", 400);
    data.endsAt = endsAt;
  }
  if ("perVisitorCap" in body) {
    const perVisitorCap = parseOptionalInt(body.perVisitorCap);
    if (perVisitorCap !== undefined && perVisitorCap < 1) return errorResponse("INVALID_REQUEST", "سقف الاسترداد للزائر يجب أن يكون 1 على الأقل.", 400);
    data.perVisitorCap = perVisitorCap ?? 1;
  }
  if (typeof body.locationLabelAr === "string") data.locationLabelAr = body.locationLabelAr.trim() || null;
  if (Object.keys(data).length === 0) return errorResponse("INVALID_REQUEST", "لم يُرسل أي حقل للتحديث.", 400);

  // Validate the (possibly updated) scope against the published catalog.
  const scopeTarget = (data.scopeTarget as string | undefined) ?? null;
  const scopeKey = (data.scopeKey as string | undefined) ?? null;
  if (scopeTarget && scopeKey) {
    if (!event.publishedCatalogVersionId) return errorResponse("CATALOG_UNAVAILABLE", "لا يوجد كتالوج منشور لهذه الفعالية.", 409);
    if (scopeTarget === "ZONE") {
      const zone = await prisma.zone.findFirst({ where: { catalogVersionId: event.publishedCatalogVersionId, stableKey: scopeKey }, select: { id: true } });
      if (!zone) return errorResponse("TARGET_NOT_FOUND", "المنطقة غير موجودة في الكتالوج المنشور.", 404);
    } else if (scopeTarget === "ACTIVITY") {
      const activity = await prisma.activity.findFirst({ where: { catalogVersionId: event.publishedCatalogVersionId, stableKey: scopeKey }, select: { id: true } });
      if (!activity) return errorResponse("TARGET_NOT_FOUND", "النشاط غير موجود في الكتالوج المنشور.", 404);
    }
  }

  const idempotency = await beginAdminIdempotency(request, {
    eventId: event.id,
    scope: `incentive.update:${incentiveId}`,
    payload: data,
  });
  if (idempotency.kind === "replay") return replayAdminIdempotency(idempotency);
  const idempotencyFailure = adminIdempotencyFailure(idempotency);
  if (idempotencyFailure) return errorResponse(idempotencyFailure.code, idempotencyFailure.message, idempotencyFailure.status);
  const idempotencyRecordId = idempotency.kind === "proceed" ? idempotency.recordId : null;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const incentive = await tx.incentive.update({ where: { id: existing.id }, data: data as never });
      await tx.auditLog.create({
        data: {
          organizationId: event.organizationId,
          action: "incentive.update",
          entityType: "Incentive",
          entityId: incentive.id,
          afterSummary: { kind: incentive.kind, trigger: incentive.trigger, scopeTarget: incentive.scopeTarget, scopeKey: incentive.scopeKey } as never,
        },
      });
      return incentive;
    });

    const row = await prisma.incentive.findFirst({ where: { id: updated.id }, include: { _count: { select: { claims: true } } } });
    const responseData = view(row as unknown as Parameters<typeof view>[0]);
    const meta = { persistence: "postgresql" };
    if (idempotencyRecordId) await completeAdminIdempotency(idempotencyRecordId, 200, { data: responseData, meta });
    return NextResponse.json({ data: responseData, meta });
  } catch (error) {
    if (idempotencyRecordId) await abandonAdminIdempotency(idempotencyRecordId);
    throw error;
  }
});
