import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeEventRequest } from "@/lib/catalog-auth";
import { enforceAdminRateLimit, isSameOrigin } from "@/lib/request-security";
import { getRequestId, withAdminApiContract } from "@/lib/api-response";
import { abandonAdminIdempotency, adminIdempotencyFailure, beginAdminIdempotency, completeAdminIdempotency, replayAdminIdempotency } from "@/lib/idempotency";
import { checkEventTransition, isEventStatus, nextEventActions, VISITOR_VISIBLE_STATUSES } from "@/lib/event-lifecycle";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

function errorResponse(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, ...(details === undefined ? {} : { details }) } }, { status });
}

/**
 * Moves an event along its lifecycle (admin/lib/event-lifecycle.ts holds the table).
 * Body: { from, to, confirm?, reason? }. `from` is the status the operator saw; the update only
 * applies while the event is still in that status, so two operators cannot race each other.
 */
export const PATCH = withAdminApiContract(async function PATCH(request: Request, context: Context) {
  if (!isSameOrigin(request)) return errorResponse("FORBIDDEN", "الطلب غير صادر من مصدر موثوق.", 403);
  const rate = await enforceAdminRateLimit(request, "event-status", 20);
  if (!rate.allowed) return errorResponse("RATE_LIMITED", "تم تجاوز عدد محاولات تغيير الحالة. حاول بعد قليل.", 429);
  const { eventSlug } = await context.params;
  const access = await authorizeEventRequest(request, eventSlug, ["OWNER", "ADMIN"]);
  if (!access.authorized) return errorResponse(access.userId ? "FORBIDDEN" : "UNAUTHORIZED", access.userId ? "صلاحية مالك أو مدير المنظمة مطلوبة." : "غير مصرح.", access.userId ? 403 : 401);
  if (!access.event) return errorResponse("EVENT_NOT_FOUND", "الفعالية غير موجودة.", 404);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return errorResponse("INVALID_REQUEST", "جسم الطلب غير صالح.", 400);
  const { from, to } = body as Record<string, unknown>;
  const confirm = (body as Record<string, unknown>).confirm === true;
  const rawReason = (body as Record<string, unknown>).reason;
  if (rawReason !== undefined && typeof rawReason !== "string") return errorResponse("INVALID_REQUEST", "سبب التغيير يجب أن يكون نصًا.", 400);
  const reason = typeof rawReason === "string" ? rawReason.trim().slice(0, 300) || null : null;
  if (!isEventStatus(from) || !isEventStatus(to)) return errorResponse("INVALID_REQUEST", "الحقلان from و to مطلوبان بحالة فعالية صحيحة.", 400);

  const event = await prisma.event.findUnique({ where: { id: access.event.id }, select: { id: true, status: true, publishedCatalogVersionId: true } });
  if (!event) return errorResponse("EVENT_NOT_FOUND", "الفعالية غير موجودة.", 404);
  if (event.status !== from) return errorResponse("EVENT_STATUS_CHANGED", "تغيّرت حالة الفعالية منذ آخر تحميل. حدّث الصفحة ثم أعد المحاولة.", 409, { current: event.status });
  const lifecycle = { hasPublishedCatalog: Boolean(event.publishedCatalogVersionId) };
  const refusal = checkEventTransition(from, to, lifecycle, confirm);
  if (refusal) return errorResponse(refusal.code, refusal.message, refusal.code === "CONFIRMATION_REQUIRED" ? 428 : 409);

  const idempotency = await beginAdminIdempotency(request, { eventId: event.id, scope: "event-status", payload: { from, to, confirm, reason } });
  const failure = adminIdempotencyFailure(idempotency);
  if (failure) return errorResponse(failure.code, failure.message, failure.status);
  if (idempotency.kind === "replay") return replayAdminIdempotency(idempotency);
  const recordId = idempotency.kind === "proceed" ? idempotency.recordId : null;

  const changedAt = new Date();
  const changed = new Error("EVENT_STATUS_CHANGED");
  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.event.updateMany({
        where: { id: event.id, status: from, ...((to === "PUBLISHED" || to === "LIVE") ? { publishedCatalogVersionId: { not: null } } : {}) },
        data: { status: to },
      });
      if (!updated.count) throw changed;
      await tx.auditLog.create({
        data: {
          organizationId: access.event!.organizationId,
          actorUserId: access.userId ?? undefined,
          action: "event.status_change",
          entityType: "Event",
          entityId: event.id,
          beforeSummary: { status: from },
          afterSummary: { status: to, ...(reason ? { reason } : {}), changedAt: changedAt.toISOString() },
          requestId: getRequestId(request),
        },
      });
    });
  } catch (error) {
    if (recordId) await abandonAdminIdempotency(recordId).catch(() => {});
    if (error === changed) return errorResponse("EVENT_STATUS_CHANGED", "تغيّرت حالة الفعالية منذ آخر تحميل. حدّث الصفحة ثم أعد المحاولة.", 409);
    throw error;
  }

  const payload = {
    data: {
      slug: eventSlug,
      previousStatus: from,
      status: to,
      changedAt: changedAt.toISOString(),
      visibleToVisitors: VISITOR_VISIBLE_STATUSES.includes(to),
      nextActions: nextEventActions(to, lifecycle),
    },
    meta: { persistence: "postgresql" },
  };
  if (recordId) await completeAdminIdempotency(recordId, 200, payload).catch(() => {});
  return NextResponse.json(payload);
});
