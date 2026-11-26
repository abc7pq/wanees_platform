import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { searchActivities } from "@/lib/assistant";
import { buildVisitorBrief } from "@/lib/agent-persona";
import { loadVisitorAgentState } from "@/lib/agent-state";
import { buildCallInstructions, callGreeting, createRealtimeClientSecret, realtimeAvailable } from "@/lib/realtime-session";
import { getVisitorToken, resolveVisitorSession } from "@/lib/visitor-auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { visitorVisitCount } from "@/lib/visitor-store";
import { jsonData, jsonError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

function noStore(response: NextResponse) {
  response.headers.set("cache-control", "no-store");
  return response;
}

// يبدأ مكالمة صوتية حية مخصصة لهذا الزائر: يرجع مفتاحًا مؤقتًا (دقيقتان) لجلسة WebRTC.
export async function POST(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  if (!getVisitorToken(request)) return jsonError(request, "SESSION_TOKEN_REQUIRED", "يلزم رمز جلسة الزيارة.", 401);
  const session = await resolveVisitorSession(eventSlug, request);
  if (!session) return jsonError(request, "SESSION_NOT_FOUND", "جلسة الزيارة غير موجودة أو انتهت.", 404);

  const rate = await enforceRateLimit(request, { scope: `assistant-call:${eventSlug}:${session.id}`, limit: 6, windowMs: 10 * 60_000 });
  if (!rate.allowed) {
    const response = jsonError(request, "RATE_LIMITED", "بدأت مكالمات كثيرة. حاول بعد قليل.", 429);
    response.headers.set("retry-after", String(rate.retryAfterSeconds));
    return response;
  }
  if (!realtimeAvailable()) return noStore(jsonError(request, "VOICE_UNAVAILABLE", "المكالمة الحية غير متاحة الآن.", 503));

  const state = await loadVisitorAgentState(eventSlug, session);
  if (!state) return jsonError(request, "CATALOG_VERSION_UNAVAILABLE", "نسخة الكتالوج المرتبطة بالجلسة غير متاحة.", 409);
  const { site, profile, nowMin, plan } = state;
  const visitedKeys = session.visitor?.visitedKeys ?? session.guestProfile?.visitedKeys ?? [];
  const visitCount = session.visitor?.id ? await visitorVisitCount(session.visitor.id).catch(() => 0) : 0;
  const visitorBrief = buildVisitorBrief({ site, profile, preferences: session.preferences, plan, nowMin, visitedKeys, visitCount });
  const planned = new Set(plan?.stops.map((stop) => stop.act_id) ?? []);
  const suggestions = searchActivities("", site, profile, session.catalogVersionId, { visitedKeys })
    .filter((source) => !planned.has(source.id))
    .slice(0, 4)
    .map((source) => `- «${source.name}» في ${source.zoneName}، ${source.priceSar == null ? "السعر غير مذكور" : source.priceSar === 0 ? "مجاني" : `${source.priceSar} ريال`}، ${source.durationMin} دقيقة (${source.reasons.join("، ")})`);
  const next = plan?.stops.find((stop) => stop.end > nowMin);
  const greeting = callGreeting({ hasPlan: Boolean(next), nextName: next?.name, withKids: profile.companions_kids, returning: visitCount > 1 });
  const secret = await createRealtimeClientSecret(buildCallInstructions({ visitorBrief, suggestions, greeting }));
  if (!secret) return noStore(jsonError(request, "VOICE_UNAVAILABLE", "تعذر بدء المكالمة الحية الآن.", 503));

  await prisma.visitorSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  return noStore(jsonData(request, {
    clientSecret: secret.clientSecret,
    expiresAt: secret.expiresAt,
    model: secret.model,
    greeting,
  }, { persistence: "none", retention: "no_audio_or_transcript_stored_by_wanees" }));
}
