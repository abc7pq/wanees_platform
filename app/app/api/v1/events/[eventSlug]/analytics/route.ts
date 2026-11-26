import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { analyticsEventSchema } from "@/lib/api-contracts";
import { getVisitorToken, resolveVisitorSession } from "@/lib/visitor-auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { jsonError as contractError } from "@/lib/api-response";
import { jsonData } from "@/lib/api-response";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  if (!getVisitorToken(request)) return errorResponse("SESSION_TOKEN_REQUIRED", "يلزم رمز جلسة الزيارة.", 401);
  if (!process.env.DATABASE_URL) return errorResponse("DATABASE_UNAVAILABLE", "القياس الدائم غير مفعل في هذا التشغيل.", 503);
  const session = await resolveVisitorSession(eventSlug, request);
  if (!session) return errorResponse("SESSION_NOT_FOUND", "جلسة الزيارة غير موجودة أو انتهت.", 404);
  const rate = await enforceRateLimit(request, { scope: `analytics:${eventSlug}:${session.id}`, limit: 60 });
  if (!rate.allowed) {
    const response = contractError(request, "RATE_LIMITED", "تم تجاوز عدد أحداث القياس. حاول بعد قليل.", 429);
    response.headers.set("retry-after", String(rate.retryAfterSeconds));
    return response;
  }
  const parsed = analyticsEventSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "حدث القياس غير صالح.", details: parsed.error.flatten() } }, { status: 400 });

  let zoneId: string | undefined;
  let activityId: string | undefined;
  if (parsed.data.zoneKey) {
    const zone = await prisma.zone.findFirst({ where: { catalogVersionId: session.catalogVersionId, stableKey: parsed.data.zoneKey }, select: { id: true } });
    if (!zone) return errorResponse("ZONE_NOT_FOUND", "المنطقة غير موجودة في نسخة الكتالوج.", 409);
    zoneId = zone.id;
  }
  if (parsed.data.activityKey) {
    const activity = await prisma.activity.findFirst({ where: { catalogVersionId: session.catalogVersionId, stableKey: parsed.data.activityKey }, select: { id: true } });
    if (!activity) return errorResponse("ACTIVITY_NOT_FOUND", "النشاط غير موجود في نسخة الكتالوج.", 409);
    activityId = activity.id;
  }

  const now = Date.now();
  const bucketStart = new Date(Math.floor(now / (5 * 60_000)) * (5 * 60_000));
  const stored = await prisma.analyticsEvent.create({
    data: {
      eventId: session.eventId,
      metricName: parsed.data.metricName,
      metricValue: parsed.data.metricValue,
      zoneId,
      activityId,
      bucketStart,
      source: "web",
    },
  });
  await prisma.visitorSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  if (parsed.data.metricName === "visit_rating" && session.visitorVisitId) {
    const { recordVisitRating } = await import("@/lib/visitor-store");
    await recordVisitRating(session.visitorVisitId, parsed.data.metricValue).catch(() => {});
  }
  return jsonData(request, { accepted: true, id: stored.id, bucketStart: bucketStart.toISOString() }, { persistence: "postgresql" }, { status: 202 });
}
