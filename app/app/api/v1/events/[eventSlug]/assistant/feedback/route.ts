import { prisma } from "@/lib/db";
import { findActivityTarget } from "@/lib/assistant";
import { loadVisitorAgentState } from "@/lib/agent-state";
import { contextExpiresAt, mergeAssistantContext, readAssistantContext, withStopFeedback } from "@/lib/assistant-context";
import { getVisitorToken, resolveVisitorSession } from "@/lib/visitor-auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { stopFeedbackRequestSchema } from "@/lib/api-contracts";
import { jsonData, jsonError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

// «وش رايك في الزرافات؟» answered in a call (or typed): the stop and a 1–5 number go into the visit's
// temporary context (ids and numbers only, 24 h) so the next call does not ask again, and into the
// anonymous aggregate the organizer sees as «أي الأنشطة أعجبت الزوار». No text is stored.
export async function POST(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  if (!getVisitorToken(request)) return jsonError(request, "SESSION_TOKEN_REQUIRED", "يلزم رمز جلسة الزيارة.", 401);
  const session = await resolveVisitorSession(eventSlug, request);
  if (!session) return jsonError(request, "SESSION_NOT_FOUND", "جلسة الزيارة غير موجودة أو انتهت.", 404);
  const parsed = stopFeedbackRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(request, "VALIDATION_ERROR", "التقييم غير صالح.", 400);
  const rate = await enforceRateLimit(request, { scope: `assistant-feedback:${eventSlug}:${session.id}`, limit: 30, windowMs: 10 * 60_000 });
  if (!rate.allowed) return jsonError(request, "RATE_LIMITED", "حاول بعد قليل.", 429);

  const state = await loadVisitorAgentState(eventSlug, session);
  if (!state) return jsonError(request, "CATALOG_VERSION_UNAVAILABLE", "نسخة الكتالوج المرتبطة بالجلسة غير متاحة.", 409);
  const { site, plan, nowMin } = state;
  // The stop by name, resolved against the published catalog; a stop in the plan wins over a lookalike.
  const planIds = new Set(plan?.stops.map((stop) => stop.act_id) ?? []);
  const activityId = findActivityTarget(parsed.data.activity, site, plan, nowMin, null, planIds.size ? planIds : undefined)
    ?? findActivityTarget(parsed.data.activity, site, plan, nowMin, null, new Set(site.activities.keys()));
  const activity = activityId ? site.activities.get(activityId) : undefined;
  if (!activity) return jsonError(request, "ACTIVITY_NOT_FOUND", "ما لقيت هذي المحطة في بيانات الفعالية.", 404);

  const now = new Date();
  const stored = readAssistantContext(session.assistantContext, session.assistantContextExpiresAt, now);
  const assistantContext = mergeAssistantContext(stored, {
    stopFeedback: withStopFeedback(stored?.stopFeedback ?? [], { activityKey: activity.id, rating: parsed.data.rating, atMinute: nowMin }),
  }, now);
  const dbActivity = await prisma.activity.findFirst({ where: { catalogVersionId: session.catalogVersionId, stableKey: activity.id }, select: { id: true, zoneId: true } });
  const bucketStart = new Date(Math.floor(now.getTime() / (5 * 60_000)) * (5 * 60_000));
  await prisma.$transaction([
    prisma.visitorSession.update({ where: { id: session.id }, data: { lastSeenAt: now, assistantContext, assistantContextExpiresAt: contextExpiresAt(now) } }),
    // Aggregate only: no session id, like visit_rating.
    prisma.analyticsEvent.create({ data: { eventId: session.eventId, metricName: "stop_rating", metricValue: parsed.data.rating, activityId: dbActivity?.id ?? null, zoneId: dbActivity?.zoneId ?? null, bucketStart, source: "call" } }),
  ]);
  return jsonData(request, { recorded: true, activity: activity.name, rating: parsed.data.rating }, { persistence: "postgresql", retention: "assistant_context_expires_after_24h" });
}
