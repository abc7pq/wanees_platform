import { NextResponse } from "next/server";
import { checkAuth, checkAuthAsync } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { findOrganizerSession } from "@/lib/organizer-auth";
import { enforceAdminRateLimit, isSameOrigin } from "@/lib/request-security";
import { authorizeEventRequest } from "@/lib/catalog-auth";
import { withAdminApiContract } from "@/lib/api-response";
import { abandonAdminIdempotency, adminIdempotencyFailure, beginAdminIdempotency, completeAdminIdempotency, replayAdminIdempotency } from "@/lib/idempotency";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

const KINDS = new Set(["FREE_ITEM", "DISCOUNT", "PRIORITY_ENTRY", "FREE_ACTIVITY", "CREDIT"]);
const TRIGGERS = new Set(["CLOSURE", "DELAY", "SCHEDULE_CHANGE", "CROWD_OVERRIDE"]);
const SCOPE_TARGETS = new Set(["EVENT", "ZONE", "ACTIVITY"]);
const READERS = ["OWNER", "ADMIN", "OPERATOR", "ANALYST", "VIEWER"] as const;

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
  const { eventSlug } = await context.params;
  const access = await authorizeEventRequest(request, eventSlug, [...READERS]);
  if (!access.authorized) {
    return errorResponse(access.userId ? "FORBIDDEN" : "UNAUTHORIZED", "صلاحية المشغّل مطلوبة لعرض الحوافز.", access.userId ? 403 : 401);
  }
  if (!access.event) return errorResponse("EVENT_NOT_FOUND", "الفعالية غير موجودة ضمن المنظمة الحالية.", 404);

  const rows = await prisma.incentive.findMany({
    where: { eventId: access.event.id },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    include: { _count: { select: { claims: true } } },
  });

  return NextResponse.json({
    data: rows.map((row) => view(row as unknown as Parameters<typeof view>[0])),
    meta: { persistence: "postgresql", count: rows.length },
  });
});

export const POST = withAdminApiContract(async function POST(request: Request, context: Context) {
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
  if (!legacyAuth && !operatorMembership) return errorResponse("FORBIDDEN", "صلاحية المشغّل مطلوبة لإنشاء الحوافز.", 403);

  const { eventSlug } = await context.params;
  const body = await request.json().catch(() => null);
  if (!isRecord(body)) return errorResponse("INVALID_REQUEST", "بيانات الحافز غير صالحة.", 400);

  const kind = typeof body.kind === "string" ? body.kind : "";
  const titleAr = typeof body.titleAr === "string" ? body.titleAr.trim() : "";
  const valueLabelAr = typeof body.valueLabelAr === "string" ? body.valueLabelAr.trim() : "";
  const reasonAr = typeof body.reasonAr === "string" ? body.reasonAr.trim() : "";
  const valueCents = parseOptionalInt(body.valueCents);
  const priority = parseOptionalInt(body.priority) ?? 0;
  const trigger = typeof body.trigger === "string" && TRIGGERS.has(body.trigger) ? body.trigger : null;
  const scopeTarget = typeof body.scopeTarget === "string" && SCOPE_TARGETS.has(body.scopeTarget) ? body.scopeTarget : null;
  const scopeKey = typeof body.scopeKey === "string" && body.scopeKey.trim() ? body.scopeKey.trim() : null;
  const minCrowdLevel = parseOptionalLevel(body.minCrowdLevel);
  const redirectZoneKey = typeof body.redirectZoneKey === "string" && body.redirectZoneKey.trim() ? body.redirectZoneKey.trim() : null;
  const startsAt = parseDate(body.startsAt);
  const endsAt = parseDate(body.endsAt);
  const perVisitorCap = parseOptionalInt(body.perVisitorCap) ?? 1;
  const locationLabelAr = typeof body.locationLabelAr === "string" && body.locationLabelAr.trim() ? body.locationLabelAr.trim() : null;

  if (!KINDS.has(kind) || !titleAr || !valueLabelAr || !reasonAr || valueCents === undefined || valueCents < 0) {
    return errorResponse("INVALID_REQUEST", "النوع والعنوان والقيمة والسبب وسعر الحافز مطلوبة بصيغة صالحة.", 400);
  }
  if (startsAt === undefined || endsAt === undefined) return errorResponse("INVALID_REQUEST", "تاريخ الحافز غير صالح.", 400);
  if (perVisitorCap < 1) return errorResponse("INVALID_REQUEST", "سقف الاسترداد للزائر يجب أن يكون 1 على الأقل.", 400);
  if (scopeTarget && !scopeKey) return errorResponse("INVALID_REQUEST", "الحافز المرتبط بمنطقة أو نشاط يتطلب scopeKey.", 400);
  if (startsAt && endsAt && startsAt > endsAt) return errorResponse("INVALID_REQUEST", "تاريخ البدء يجب أن يسبق تاريخ الانتهاء.", 400);

  const organizationSlug = operatorMembership?.organization.slug ?? process.env.WANEES_ORGANIZATION_SLUG ?? "wanees-demo";
  const event = await prisma.event.findFirst({
    where: { slug: eventSlug, organization: { slug: organizationSlug } },
    select: { id: true, organizationId: true, publishedCatalogVersionId: true },
  });
  if (!event) return errorResponse("EVENT_NOT_FOUND", "الفعالية غير موجودة ضمن المنظمة الحالية.", 404);
  if (!event.publishedCatalogVersionId) return errorResponse("CATALOG_UNAVAILABLE", "لا يوجد كتالوج منشور لهذه الفعالية.", 409);

  if (scopeTarget === "ZONE" && scopeKey) {
    const zone = await prisma.zone.findFirst({ where: { catalogVersionId: event.publishedCatalogVersionId, stableKey: scopeKey }, select: { id: true } });
    if (!zone) return errorResponse("TARGET_NOT_FOUND", "المنطقة غير موجودة في الكتالوج المنشور.", 404);
  }
  if (scopeTarget === "ACTIVITY" && scopeKey) {
    const activity = await prisma.activity.findFirst({ where: { catalogVersionId: event.publishedCatalogVersionId, stableKey: scopeKey }, select: { id: true } });
    if (!activity) return errorResponse("TARGET_NOT_FOUND", "النشاط غير موجود في الكتالوج المنشور.", 404);
  }

  if (redirectZoneKey) {
    const zone = await prisma.zone.findFirst({ where: { catalogVersionId: event.publishedCatalogVersionId, stableKey: redirectZoneKey }, select: { id: true } });
    if (!zone) return errorResponse("TARGET_NOT_FOUND", "منطقة البديل غير موجودة في الكتالوج المنشور.", 404);
  }

  const idempotency = await beginAdminIdempotency(request, {
    eventId: event.id,
    scope: "incentive.create",
    payload: { kind, titleAr, valueLabelAr, reasonAr, valueCents, priority, trigger, scopeTarget, scopeKey, minCrowdLevel, redirectZoneKey, startsAt: startsAt?.toISOString() ?? null, endsAt: endsAt?.toISOString() ?? null, perVisitorCap, locationLabelAr },
  });
  if (idempotency.kind === "replay") return replayAdminIdempotency(idempotency);
  const idempotencyFailure = adminIdempotencyFailure(idempotency);
  if (idempotencyFailure) return errorResponse(idempotencyFailure.code, idempotencyFailure.message, idempotencyFailure.status);
  const idempotencyRecordId = idempotency.kind === "proceed" ? idempotency.recordId : null;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const incentive = await tx.incentive.create({
        data: {
          eventId: event.id,
          kind: kind as never,
          titleAr,
          valueLabelAr,
          reasonAr,
          valueCents,
          priority,
          trigger: trigger as never,
          scopeTarget: scopeTarget as never,
          scopeKey,
          minCrowdLevel,
          redirectZoneKey,
          startsAt,
          endsAt,
          perVisitorCap,
          locationLabelAr,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: event.organizationId,
          action: "incentive.create",
          entityType: "Incentive",
          entityId: incentive.id,
          afterSummary: { kind, trigger, scopeTarget, scopeKey } as never,
        },
      });
      return incentive;
    });
    const data = view({ ...created, _count: { claims: 0 } } as unknown as Parameters<typeof view>[0]);
    const meta = { persistence: "postgresql" };
    if (idempotencyRecordId) await completeAdminIdempotency(idempotencyRecordId, 201, { data, meta });
    return NextResponse.json({ data, meta }, { status: 201 });
  } catch (error) {
    if (idempotencyRecordId) await abandonAdminIdempotency(idempotencyRecordId);
    throw error;
  }
});
