import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { searchActivities, visitProgress } from "@/lib/assistant";
import { buildVisitorBrief, type VisitMemory } from "@/lib/agent-persona";
import { loadVisitorAgentState } from "@/lib/agent-state";
import { contextExpiresAt, mergeAssistantContext, readAssistantContext } from "@/lib/assistant-context";
import { buildCallInstructions, callGreeting, createRealtimeClientSecret, realtimeAvailable, type RecentTurn } from "@/lib/realtime-session";
import { getVisitorToken, resolveVisitorSession } from "@/lib/visitor-auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { visitorVisitCount } from "@/lib/visitor-store";
import { originPhrase, resolvePosition } from "@/lib/visitor-position";
import { chooseFocusZones, useLlmBreakerFor } from "@/lib/llm";
import { minutesText } from "@/lib/agent-persona";
import { seededZonePicks, validZonePicks, zoneOptionRows, zoneOptions } from "@/lib/zone-picks";
import { redactConversationText } from "@/lib/assistant";
import { assistantCallRequestSchema } from "@/lib/api-contracts";
import { jsonData, jsonError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

function noStore(response: NextResponse) {
  response.headers.set("cache-control", "no-store");
  return response;
}

// يبدأ مكالمة صوتية حية مخصصة لهذا الزائر: يرجع مفتاحًا مؤقتًا (دقيقتان) لجلسة WebRTC.
// v7: المكالمة تعرف وش صار في الزيارة (المحطة الحالية والمنتهية، الموقع، آخر الحديث، التقييمات)
// وتكمّل من حيث توقفت؛ وزائر بلا مسار يُستقبل بسوالف المرشد لا بمسار مفروض.
export async function POST(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  if (!getVisitorToken(request)) return jsonError(request, "SESSION_TOKEN_REQUIRED", "يلزم رمز جلسة الزيارة.", 401);
  const session = await resolveVisitorSession(eventSlug, request);
  if (!session) return jsonError(request, "SESSION_NOT_FOUND", "جلسة الزيارة غير موجودة أو انتهت.", 404);
  const body = await request.text().then((text) => (text.trim() ? JSON.parse(text) : {})).catch(() => null);
  const parsed = assistantCallRequestSchema.safeParse(body ?? {});
  if (!parsed.success) return jsonError(request, "VALIDATION_ERROR", "طلب بدء المكالمة غير صالح.", 400);

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
  const now = new Date();
  const visitedKeys = session.visitor?.visitedKeys ?? session.guestProfile?.visitedKeys ?? [];
  const visitCount = session.visitor?.id ? await visitorVisitCount(session.visitor.id).catch(() => 0) : session.guestProfile?.visitCount ?? 0;
  const earlierVisits = session.previouslyVisited.length ? session.previouslyVisited : visitedKeys;

  // ————— ذاكرة الزيارة: كلها من قاعدة البيانات والساعة، بلا نص خام —————
  const storedContext = readAssistantContext(session.assistantContext, session.assistantContextExpiresAt, now);
  const callCount = (storedContext?.callCount ?? 0) + 1;
  let assistantContext = mergeAssistantContext(storedContext, { callCount }, now);
  const progress = visitProgress(plan, nowMin);
  const stopFeedback = assistantContext.stopFeedback
    .map((item) => ({ name: site.activities.get(item.activityKey)?.name ?? "", rating: item.rating }))
    .filter((item) => item.name);
  const [turnRows, dismissed, accepted] = await Promise.all([
    prisma.conversationTurn.findMany({
      where: { sessionId: session.id, retentionExpiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { role: true, redactedContent: true },
    }),
    prisma.itinerary.findFirst({ where: { sessionId: session.id, status: "dismissed", decisionAt: { not: null } }, orderBy: { decisionAt: "desc" }, select: { decisionAt: true } }),
    prisma.itinerary.findFirst({ where: { sessionId: session.id, generatedReason: { endsWith: "_accepted" } }, orderBy: { generatedAt: "desc" }, select: { generatedAt: true } }),
  ]);
  const recentTurns: RecentTurn[] = turnRows.reverse()
    .filter((row) => row.redactedContent)
    .map((row) => ({ role: row.role === "assistant" ? "assistant" : "visitor", text: row.redactedContent! }));
  const dismissedAt = dismissed?.decisionAt?.getTime() ?? 0;
  const acceptedAt = accepted?.generatedAt?.getTime() ?? 0;
  const lastDecision = !dismissedAt && !acceptedAt ? null
    : acceptedAt >= dismissedAt ? "قبل قليل اعتمد آخر اقتراح تعديل على مساره." : "رفض آخر اقتراح تعديل وأبقى مساره كما هو.";
  // Where the visitor is: the device position sent with this call (a walkway node, validated), else nothing.
  const resolved = parsed.data.position ? resolvePosition(site, parsed.data.position, now) : null;
  const position = resolved?.ok ? originPhrase(resolved.position.source, resolved.position.label, false) : null;
  const memory: VisitMemory = { progress, callCount, stopFeedback, lastDecision, position };

  const visitorBrief = buildVisitorBrief({ site, profile, preferences: session.preferences, plan, nowMin, visitedKeys: earlierVisits, visitCount, memory });
  const planned = new Set(plan?.stops.map((stop) => stop.act_id) ?? []);
  // v6: each pick carries its published description, highlights and age limit, so the voice can say why
  // («فيه ممر زجاجي تحت الأسود») instead of a bare name, and never offers an under-age activity as suitable.
  const suggestions = searchActivities("", site, profile, session.catalogVersionId, { visitedKeys })
    .filter((source) => !planned.has(source.id))
    .slice(0, 5)
    .map((source) => {
      const price = source.priceSar == null ? "السعر غير مذكور" : source.priceSar === 0 ? "مجاني" : `${source.priceSar} ريال`;
      const extras = [
        source.minAge != null ? `الحد الأدنى للعمر ${source.minAge} سنوات` : null,
        source.description ? `الوصف: ${source.description.slice(0, 140)}` : null,
        source.highlights?.length ? `أبرز ما فيه: ${source.highlights.slice(0, 2).join("؛ ")}` : null,
      ].filter(Boolean);
      return `- «${source.name}» في ${source.zoneName}، ${price}، ${source.durationMin} دقيقة (${source.reasons.join("، ")})${extras.length ? `. ${extras.join(". ")}` : ""}`;
    });
  const zones = [...site.zones.values()].map((zone) => zone.name).slice(0, 40);
  // Agent v8: a visitor with no plan is told where to go first. The zones are picked for this visitor
  // (the guide chooses among options computed from the catalog; a seeded draw when it cannot), and
  // kept in the visit context so the plan the engine builds during the call heads to the same ones.
  let zonePickOptions: ReturnType<typeof zoneOptions> = [];
  if (!plan?.stops.length) {
    useLlmBreakerFor(session.id);
    const pickProfile = { ...profile, variety_seed: session.id };
    const options = zoneOptions(site, pickProfile, nowMin);
    const stored = validZonePicks(storedContext?.focusZones, options);
    const lastVisitorTurn = [...recentTurns].reverse().find((turn) => turn.role === "visitor")?.text ?? "";
    const picked = stored.length ? stored : validZonePicks(await chooseFocusZones({
      message: redactConversationText(lastVisitorTurn),
      visitorBrief,
      options: zoneOptionRows(options, session.id),
    }).catch(() => null), options);
    const focus = picked.length >= 2 ? picked : seededZonePicks(options, session.id);
    zonePickOptions = focus.flatMap((id) => options.find((option) => option.id === id) ?? []);
    if (focus.length) assistantContext = mergeAssistantContext(assistantContext, { focusZones: focus }, now);
  }
  const zonePicks = zonePickOptions.map((option) => `- ${option.name}${option.flavours.length ? `: تشتهر بـ ${option.flavours.join("، ")}` : ""} (المشي لها ${minutesText(option.walkMin)})`);
  const lastVisitKey = earlierVisits.at(-1);
  const greeting = callGreeting({
    hasPlan: Boolean(plan?.stops.length),
    nextName: progress.next?.name,
    minutesToNext: progress.next ? progress.next.start - nowMin : undefined,
    withKids: profile.companions_kids,
    returning: visitCount > 1,
    venueName: site.venueName,
    zoneNames: zonePickOptions.map((option) => option.name),
    lastVisitName: lastVisitKey ? site.activities.get(lastVisitKey)?.name : undefined,
    resume: callCount > 1,
    justFinishedName: progress.justFinished?.name,
    rated: progress.justFinished ? assistantContext.stopFeedback.some((item) => item.activityKey === progress.justFinished!.act_id) : false,
    currentName: progress.current?.name,
  });
  const secret = await createRealtimeClientSecret(buildCallInstructions({ visitorBrief, suggestions, greeting, zones, zonePicks, recentTurns }));
  if (!secret) return noStore(jsonError(request, "VOICE_UNAVAILABLE", "تعذر بدء المكالمة الحية الآن.", 503));

  await prisma.visitorSession.update({
    where: { id: session.id },
    data: { lastSeenAt: now, assistantContext, assistantContextExpiresAt: contextExpiresAt(now) },
  }).catch(() => undefined);
  return noStore(jsonData(request, {
    clientSecret: secret.clientSecret,
    expiresAt: secret.expiresAt,
    model: secret.model,
    greeting,
    callCount,
  }, { persistence: "none", retention: "no_audio_or_transcript_stored_by_wanees" }));
}
