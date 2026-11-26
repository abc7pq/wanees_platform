import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeEventRequest } from "@/lib/catalog-auth";
import { withAdminApiContract } from "@/lib/api-response";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function parseDate(value: unknown): Date | null | undefined {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Read-only preview of an operational update before it is published: how many visitors with an
 * active plan have a stop on the target inside the update window. Aggregate counts only — no
 * session identifiers leave the server.
 */
export const POST = withAdminApiContract(async function POST(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  const access = await authorizeEventRequest(request, eventSlug, ["OWNER", "ADMIN", "OPERATOR"]);
  if (!access.authorized) return errorResponse(access.userId ? "FORBIDDEN" : "UNAUTHORIZED", access.userId ? "لا تملك صلاحية هذه الفعالية." : "غير مصرح.", access.userId ? 403 : 401);
  if (!access.event) return errorResponse("EVENT_NOT_FOUND", "الفعالية غير موجودة.", 404);

  const body = await request.json().catch(() => null);
  const targetType = typeof body?.targetType === "string" ? body.targetType : "";
  const targetId = typeof body?.targetId === "string" ? body.targetId.trim() : "";
  const startsAt = parseDate(body?.startsAt);
  const endsAt = parseDate(body?.endsAt);
  if (!["activity", "zone", "event"].includes(targetType) || (targetType !== "event" && !targetId) || startsAt === undefined || endsAt === undefined) {
    return errorResponse("INVALID_REQUEST", "حدد الهدف ونافذة التحديث بشكل صحيح.", 400);
  }
  const now = new Date();
  const windowStart = startsAt ?? now;
  if (endsAt && endsAt <= windowStart) return errorResponse("INVALID_REQUEST", "نهاية التحديث يجب أن تكون بعد بدايته.", 400);

  const items = await prisma.itineraryItem.findMany({
    where: {
      state: { not: "done" },
      endsAt: { gt: windowStart },
      ...(endsAt ? { startsAt: { lt: endsAt } } : {}),
      ...(targetType === "activity" ? { activity: { stableKey: targetId } } : {}),
      ...(targetType === "zone" ? { activity: { zone: { stableKey: targetId } } } : {}),
      itinerary: {
        eventId: access.event.id,
        status: "active",
        session: { expiresAt: { gt: now }, deletedAt: null },
      },
    },
    select: { startsAt: true, itinerary: { select: { sessionId: true } } },
  });

  const visitors = new Set(items.map((item) => item.itinerary.sessionId));
  const firstAffectedAt = items.reduce<Date | null>((first, item) => (!first || item.startsAt < first ? item.startsAt : first), null);
  return NextResponse.json({
    data: {
      targetType,
      targetId: targetId || null,
      windowStart: windowStart.toISOString(),
      windowEnd: endsAt?.toISOString() ?? null,
      affectedVisitors: visitors.size,
      affectedStops: items.length,
      firstAffectedAt: firstAffectedAt?.toISOString() ?? null,
    },
  }, { headers: { "cache-control": "no-store" } });
});
