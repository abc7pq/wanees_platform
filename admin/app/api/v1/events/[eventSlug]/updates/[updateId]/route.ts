import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeEventRequest } from "@/lib/catalog-auth";
import { withAdminApiContract } from "@/lib/api-response";
import { enforceAdminRateLimit, isSameOrigin } from "@/lib/request-security";
import { abandonAdminIdempotency, adminIdempotencyFailure, beginAdminIdempotency, completeAdminIdempotency, replayAdminIdempotency } from "@/lib/idempotency";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string; updateId: string }> };
const writableRoles = ["OWNER", "ADMIN", "OPERATOR"] as const;

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export const PATCH = withAdminApiContract(async function PATCH(request: Request, context: Context) {
  if (!isSameOrigin(request)) return errorResponse("FORBIDDEN", "الطلب غير صادر من مصدر موثوق.", 403);
  const rate = await enforceAdminRateLimit(request, "event-update-revoke", 60);
  if (!rate.allowed) {
    const response = errorResponse("RATE_LIMITED", "تم تجاوز عدد عمليات سحب التحديثات. حاول بعد قليل.", 429);
    response.headers.set("retry-after", String(rate.retryAfterSeconds));
    return response;
  }
  if (!process.env.DATABASE_URL) return errorResponse("DATABASE_UNAVAILABLE", "قاعدة البيانات غير مفعلة.", 503);

  const { eventSlug, updateId } = await context.params;
  const access = await authorizeEventRequest(request, eventSlug, [...writableRoles]);
  if (!access.authorized) {
    return errorResponse(access.userId ? "FORBIDDEN" : "UNAUTHORIZED", "صلاحية المشغّل مطلوبة لسحب التحديث.", access.userId ? 403 : 401);
  }
  if (!access.event) return errorResponse("EVENT_NOT_FOUND", "الفعالية غير موجودة ضمن المنظمة الحالية.", 404);

  const body = await request.json().catch(() => null);
  if (!isRecord(body) || Object.keys(body).some((key) => !["action", "reason"].includes(key)) || body.action !== "revoke") {
    return errorResponse("INVALID_REQUEST", "الإجراء المطلوب غير صالح.", 400);
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (body.reason !== undefined && typeof body.reason !== "string") {
    return errorResponse("INVALID_REQUEST", "سبب السحب يجب أن يكون نصًا.", 400);
  }
  if (reason.length > 500) return errorResponse("INVALID_REQUEST", "سبب السحب يتجاوز 500 حرف.", 400);

  const existing = await prisma.eventUpdate.findFirst({
    where: { id: updateId, eventId: access.event.id },
    select: {
      id: true,
      updateType: true,
      targetType: true,
      targetId: true,
      startsAt: true,
      endsAt: true,
      createdAt: true,
      revokedAt: true,
      revocationReason: true,
    },
  });
  if (!existing) return errorResponse("UPDATE_NOT_FOUND", "التحديث غير موجود في هذه الفعالية.", 404);

  const idempotency = await beginAdminIdempotency(request, {
    eventId: access.event.id,
    scope: `event-update.revoke:${updateId}`,
    payload: { action: "revoke", reason },
  });
  if (idempotency.kind === "replay") return replayAdminIdempotency(idempotency);
  const idempotencyFailure = adminIdempotencyFailure(idempotency);
  if (idempotencyFailure) return errorResponse(idempotencyFailure.code, idempotencyFailure.message, idempotencyFailure.status);
  const idempotencyRecordId = idempotency.kind === "proceed" ? idempotency.recordId : null;
  if (existing.revokedAt) {
    const data = { id: existing.id, status: "REVOKED", revokedAt: existing.revokedAt.toISOString(), alreadyRevoked: true };
    const meta = { persistence: "postgresql" };
    if (idempotencyRecordId) await completeAdminIdempotency(idempotencyRecordId, 200, { data, meta });
    return NextResponse.json({ data, meta });
  }

  const now = new Date();
  const previousStatus = existing.endsAt && existing.endsAt < now
    ? "expired"
    : existing.startsAt && existing.startsAt > now
      ? "scheduled"
      : "active";
  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const result = await tx.eventUpdate.updateMany({
        where: { id: existing.id, eventId: access.event!.id, revokedAt: null },
        data: {
          revokedAt: now,
          revokedByUserId: access.userId,
          revocationReason: reason || null,
        },
      });
      const updated = await tx.eventUpdate.findUniqueOrThrow({ where: { id: existing.id } });
      if (result.count === 0) return { update: updated, alreadyRevoked: true };

      await tx.auditLog.create({
        data: {
          organizationId: access.event!.organizationId,
          actorUserId: access.userId ?? undefined,
          action: "event_update.revoke",
          entityType: "EventUpdate",
          entityId: updated.id,
          beforeSummary: {
            updateType: existing.updateType,
            targetType: existing.targetType,
            targetId: existing.targetId,
            startsAt: existing.startsAt?.toISOString() ?? null,
            endsAt: existing.endsAt?.toISOString() ?? null,
            status: previousStatus,
          },
          afterSummary: {
            status: "revoked",
            revokedAt: now.toISOString(),
            reason: reason || null,
          },
        },
      });
      return { update: updated, alreadyRevoked: false };
    });

    const data = {
      id: outcome.update.id,
      status: "REVOKED",
      revokedAt: outcome.update.revokedAt?.toISOString() ?? now.toISOString(),
      revocationReason: outcome.update.revocationReason,
      alreadyRevoked: outcome.alreadyRevoked,
    };
    const meta = { persistence: "postgresql" };
    if (idempotencyRecordId) await completeAdminIdempotency(idempotencyRecordId, 200, { data, meta });
    return NextResponse.json({ data, meta });
  } catch (error) {
    if (idempotencyRecordId) await abandonAdminIdempotency(idempotencyRecordId);
    throw error;
  }
});
