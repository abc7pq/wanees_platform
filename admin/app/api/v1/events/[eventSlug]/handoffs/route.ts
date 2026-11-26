import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeEventRequest } from "@/lib/catalog-auth";
import { enforceAdminRateLimit, isSameOrigin } from "@/lib/request-security";
import { withAdminApiContract } from "@/lib/api-response";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };
const readableRoles = ["OWNER", "ADMIN", "OPERATOR", "ANALYST", "VIEWER"] as const;
const writableRoles = ["OWNER", "ADMIN", "OPERATOR"] as const;
const statuses = new Set(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]);

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function authError(access: { authorized: boolean; userId: string | null; event: unknown | null }) {
  return access.authorized
    ? null
    : errorResponse(access.userId ? "FORBIDDEN" : "UNAUTHORIZED", access.userId ? "لا تملك صلاحية متابعة طلبات الزوار." : "غير مصرح.", access.userId ? 403 : 401);
}

export const GET = withAdminApiContract(async function GET(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  const access = await authorizeEventRequest(request, eventSlug, [...readableRoles]);
  const unauthorized = authError(access);
  if (unauthorized) return unauthorized;
  if (!access.event) return errorResponse("EVENT_NOT_FOUND", "الفعالية غير موجودة.", 404);

  const url = new URL(request.url);
  const requestedStatus = url.searchParams.get("status")?.toUpperCase();
  const status = requestedStatus && statuses.has(requestedStatus) ? requestedStatus : undefined;
  const rows = await prisma.visitorHandoff.findMany({
    where: { eventId: access.event.id, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, category: true, redactedMessage: true, status: true, createdAt: true, resolvedAt: true },
  });

  return NextResponse.json({
    data: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), resolvedAt: row.resolvedAt?.toISOString() ?? null })),
    meta: { persistence: "postgresql", privacy: "redacted_message_only" },
  });
});

export const PATCH = withAdminApiContract(async function PATCH(request: Request, context: Context) {
  if (!isSameOrigin(request)) return errorResponse("FORBIDDEN", "تعذر التحقق من مصدر الطلب.", 403);
  const rate = await enforceAdminRateLimit(request, "handoff-update", 120);
  if (!rate.allowed) return errorResponse("RATE_LIMITED", "انتظر قليلًا قبل تحديث طلب آخر.", 429);
  const { eventSlug } = await context.params;
  const access = await authorizeEventRequest(request, eventSlug, [...writableRoles]);
  const unauthorized = authError(access);
  if (unauthorized) return unauthorized;
  if (!access.event) return errorResponse("EVENT_NOT_FOUND", "الفعالية غير موجودة.", 404);

  const body = await request.json().catch(() => null) as { handoffId?: unknown; status?: unknown } | null;
  const handoffId = typeof body?.handoffId === "string" ? body.handoffId.trim() : "";
  const status = typeof body?.status === "string" ? body.status.toUpperCase() : "";
  if (!handoffId || !statuses.has(status)) return errorResponse("INVALID_REQUEST", "معرف الطلب وحالته غير صالحين.", 400);

  const existing = await prisma.visitorHandoff.findFirst({
    where: { id: handoffId, eventId: access.event.id },
    select: { id: true, status: true },
  });
  if (!existing) return errorResponse("HANDOFF_NOT_FOUND", "طلب المساعدة غير موجود في هذه الفعالية.", 404);

  const resolvedAt = status === "RESOLVED" || status === "CLOSED" ? new Date() : null;
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.visitorHandoff.update({ where: { id: existing.id }, data: { status, resolvedAt } });
    await tx.auditLog.create({
      data: {
        organizationId: access.event!.organizationId,
        actorUserId: access.userId ?? undefined,
        action: "visitor_handoff.update",
        entityType: "VisitorHandoff",
        entityId: row.id,
        beforeSummary: { status: existing.status },
        afterSummary: { status: row.status },
      },
    });
    return row;
  });

  return NextResponse.json({
    data: { id: updated.id, status: updated.status, resolvedAt: updated.resolvedAt?.toISOString() ?? null },
    meta: { persistence: "postgresql" },
  });
});
