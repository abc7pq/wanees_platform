import { computeNudges } from "@/lib/nudges";
import { loadVisitorAgentState } from "@/lib/agent-state";
import { getVisitorToken, resolveVisitorSession } from "@/lib/visitor-auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { jsonData, jsonError } from "@/lib/api-response";
import { markNudgesDelivered } from "@/lib/push-dispatch";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

// تنبيهات ونيس الاستباقية لهذا الزائر الآن (تحرك للمحطة الجاية، عرض يبدأ، نهاية الزيارة).
// لا تغيّر المسار، والعميل يعرض كل معرّف مرة واحدة. الكتابة الوحيدة: ما عرضه التطبيق المفتوح يُعلَّم
// كمُسلَّم لاشتراكات شاشة القفل، حتى لا يتكرر نفس التنبيه على الجوال.
export async function GET(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  if (!getVisitorToken(request)) return jsonError(request, "SESSION_TOKEN_REQUIRED", "يلزم رمز جلسة الزيارة.", 401);
  const session = await resolveVisitorSession(eventSlug, request);
  if (!session) return jsonError(request, "SESSION_NOT_FOUND", "جلسة الزيارة غير موجودة أو انتهت.", 404);
  const rate = await enforceRateLimit(request, { scope: `assistant-nudges:${eventSlug}:${session.id}`, limit: 20 });
  if (!rate.allowed) {
    const response = jsonError(request, "RATE_LIMITED", "طلبات كثيرة. حاول بعد قليل.", 429);
    response.headers.set("retry-after", String(rate.retryAfterSeconds));
    return response;
  }
  const state = await loadVisitorAgentState(eventSlug, session);
  if (!state) return jsonError(request, "CATALOG_VERSION_UNAVAILABLE", "نسخة الكتالوج المرتبطة بالجلسة غير متاحة.", 409);
  const nudges = computeNudges({
    site: state.site,
    plan: state.plan,
    profile: state.profile,
    nowMin: state.nowMin,
    isOpen: state.clock.isOpen !== false,
    walkingTolerance: session.preferences?.walkingTolerance,
  });
  await markNudgesDelivered(session.id, nudges.map((nudge) => nudge.id)).catch(() => {});
  const response = jsonData(request, { nudges, clock: state.clock, nextPollAfterMs: 60_000 }, { persistence: "none" });
  response.headers.set("cache-control", "no-store");
  return response;
}
