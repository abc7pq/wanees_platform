import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { Site } from "@/engine/site.ts";
import { buildRoute } from "@/engine/route.ts";
import { prisma } from "@/lib/db";
import { loadSessionCatalog } from "@/lib/db-catalog";
import { assistantRequestSchema } from "@/lib/api-contracts";
import {
  applyAgentModification,
  chatReply,
  decide,
  findActivityTarget,
  isLostChild,
  isProposalDecisionMessage,
  arabicYears,
  namedActivity,
  parsePartyDetails,
  isRecommendationQuery,
  listAlternatives,
  unmatchedDetailSubject,
  upcomingSchedule,
  venueFaqTopics,
  namedDirectionTargets,
  nextStop,
  searchActivities,
  sourceForLocation,
  redactConversationText,
  sourceForActivity,
  toEngineItinerary,
  type StoredItinerary,
} from "@/lib/assistant";
import { composeReply } from "@/lib/llm";
import { guardrailReply, guardrailTopic } from "@/lib/agent-guardrails";
import { mergeVisitorPreferences, recordSessionPlan, visitorVisitCount } from "@/lib/visitor-store";
import { buildVisitorBrief, clockText, compactSources, minutesText, prefersEnglish } from "@/lib/agent-persona";
import { stationsCount } from "@/lib/ar-count";
import { actionToVisitorMessage, buildAssistantSurface, validateA2uiMessages } from "@/lib/a2ui";
import { getChatHistory, rememberChatTurn } from "@/lib/chat-history";
import { contextExpiresAt, mergeAssistantContext, readAssistantContext, type AssistantContext } from "@/lib/assistant-context";
import { getEventClock } from "@/lib/event-clock";
import { getVisitorToken, resolveVisitorSession } from "@/lib/visitor-auth";
import { resolveVisitWindow, visitNowMinute } from "@/lib/visitor-profile";
import { venueWeather } from "@/lib/live-weather";
import { enforceRateLimit } from "@/lib/rate-limit";
import { jsonError as contractError } from "@/lib/api-response";
import { jsonData } from "@/lib/api-response";
import { activeLiveEvents } from "@/lib/active-live-events";
import { isMeasuredCrowd, loadCurrentCrowdSnapshots } from "@/lib/live-updates";
import { describeWalkingBrief, fuzzyActivityTarget, likelyOrigin, walkingBrief, type WalkingBrief } from "@/lib/walking-brief";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function dateForPlanMinute(base: Date, startMinute: number, minute: number) {
  return new Date(base.getTime() + (minute - startMinute) * 60_000);
}

function describeNextStop(plan: ReturnType<typeof toEngineItinerary> | null, nowMin: number) {
  const stop = nextStop(plan, nowMin);
  return stop ? { activityId: stop.act_id, name: stop.name, start: stop.start, end: stop.end, zone: stop.zone } : null;
}

function crowdSourceRows(
  snapshots: Array<{ level: number; source: string; confidence: number; observedAt: Date; zone: { stableKey: string; nameAr: string } }>,
  site: Site,
  plan: ReturnType<typeof toEngineItinerary> | null,
  nowMin: number,
  allowSimulation: boolean,
) {
  if (snapshots.length) {
    return snapshots.map((snapshot) => ({
      zone: snapshot.zone.stableKey,
      zoneName: snapshot.zone.nameAr,
      level: snapshot.level,
      source: snapshot.source.toLowerCase(),
      confidence: snapshot.confidence,
      observedAt: snapshot.observedAt.toISOString(),
    }));
  }
  if (!allowSimulation) return [];
  const zones = [...new Set((plan?.stops ?? []).filter((stop) => stop.end > nowMin).map((stop) => stop.zone))];
  return zones.map((zoneId) => ({
    zone: zoneId,
    zoneName: site.zones.get(zoneId)?.name ?? zoneId,
    level: site.crowd(zoneId, nowMin),
    source: "simulated",
    confidence: 0.35,
    observedAt: new Date().toISOString(),
  }));
}

function sourceRowsForPlan(plan: ReturnType<typeof toEngineItinerary> | null, site: Site, catalogVersionId: string) {
  return (plan?.stops ?? []).map((stop) => {
    const activity = site.activities.get(stop.act_id);
    return activity ? { ...sourceForActivity(activity, catalogVersionId), zoneName: site.zones.get(activity.zone)?.name ?? activity.zone } : null;
  }).filter((source): source is NonNullable<typeof source> => Boolean(source));
}

function diffPlans(before: ReturnType<typeof toEngineItinerary>, after: ReturnType<typeof toEngineItinerary>) {
  const beforeById = new Map(before.stops.map((stop) => [stop.act_id, stop]));
  const afterById = new Map(after.stops.map((stop) => [stop.act_id, stop]));
  const removed = before.stops.filter((stop) => !afterById.has(stop.act_id)).map((stop) => ({ id: stop.act_id, name: stop.name }));
  const added = after.stops.filter((stop) => !beforeById.has(stop.act_id)).map((stop) => ({ id: stop.act_id, name: stop.name }));
  const moved = after.stops.filter((stop) => {
    const previous = beforeById.get(stop.act_id);
    return previous && (previous.start !== stop.start || previous.end !== stop.end);
  }).map((stop) => ({ id: stop.act_id, name: stop.name }));
  return { changed: removed.length > 0 || added.length > 0 || moved.length > 0, removed, added, moved };
}

function formatSchedule(schedule: { type: "slots"; slots: number[] } | { type: "continuous"; from: number; to: number }) {
  const fmt = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  return schedule.type === "slots" ? schedule.slots.map(fmt).join("، ") : `${fmt(schedule.from)}–${fmt(schedule.to)}`;
}

async function loadLatestItinerary(sessionId: string, eventId: string, catalogVersionId: string) {
  return prisma.itinerary.findFirst({
    where: { sessionId, eventId, catalogVersionId, status: "active" },
    orderBy: { generatedAt: "desc" },
    include: {
      items: {
        orderBy: { sequence: "asc" },
        include: { activity: { include: { zone: true } } },
      },
    },
  });
}

export async function POST(request: Request, context: Context) {
  const startedAt = Date.now();
  const { eventSlug } = await context.params;
  if (!getVisitorToken(request)) return jsonError("SESSION_TOKEN_REQUIRED", "يلزم رمز جلسة الزيارة.", 401);

  const session = await resolveVisitorSession(eventSlug, request);
  if (!session) return jsonError("SESSION_NOT_FOUND", "جلسة الزيارة غير موجودة أو انتهت.", 404);

  const rate = await enforceRateLimit(request, { scope: `assistant:${eventSlug}:${session.id}`, limit: 30 });
  if (!rate.allowed) {
    const response = contractError(request, "RATE_LIMITED", "تم تجاوز عدد رسائل المرشد. حاول بعد قليل.", 429);
    response.headers.set("retry-after", String(rate.retryAfterSeconds));
    return response;
  }

  const parsed = assistantRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "رسالة المرشد غير صالحة.", details: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const catalogResult = await loadSessionCatalog(eventSlug, session.catalogVersionId);
  if (!catalogResult || catalogResult.catalogVersionId !== session.catalogVersionId) {
    return jsonError("CATALOG_VERSION_UNAVAILABLE", "نسخة الكتالوج المرتبطة بالجلسة غير متاحة.", 409);
  }

  const clock = getEventClock({
    eventSlug,
    startsAt: catalogResult.eventStartsAt,
    endsAt: catalogResult.eventEndsAt,
    timezone: catalogResult.venueTimezone,
    openingFrom: catalogResult.catalog.site.opening.from,
    openingTo: catalogResult.catalog.site.opening.to,
  });
  const visit = resolveVisitWindow(catalogResult.catalog, session.preferences, clock.nowMinute);
  const profile = visit.profile;
  const site = new Site(catalogResult.catalog);
  const latest = await loadLatestItinerary(session.id, session.eventId, session.catalogVersionId);
  const currentPlan = latest
    ? toEngineItinerary(latest as unknown as StoredItinerary, catalogResult.catalog, profile)
    : null;
  const nowMin = visitNowMinute(visit, clock.nowMinute);
  const storedContext = readAssistantContext(session.assistantContext, session.assistantContextExpiresAt);
  let contextToPersist: AssistantContext | null = storedContext;
  let contextChanged = Boolean(session.assistantContext && !storedContext);
  const pendingChange = storedContext?.pendingStopChange;
  const activePendingChange = pendingChange?.itineraryId === latest?.id ? pendingChange : undefined;
  // A2UI: a tapped card button arrives as an A2UI action and becomes a deterministic visitor message.
  const visitorMessage = parsed.data.message ?? (parsed.data.action
    ? actionToVisitorMessage(parsed.data.action.action, (activityId) => site.activities.get(activityId)?.name)
    : null);
  if (!visitorMessage) return jsonError("A2UI_ACTION_UNSUPPORTED", "هذا الإجراء يُنفّذ في التطبيق نفسه أو يشير لنشاط غير موجود.", 400);
  const channel = parsed.data.channel ?? "text";
  const history = getChatHistory(session.id);
  const previousAssistantTurn = [...history].reverse().find((turn) => turn.role === "assistant")?.text;
  // «اعتمده» typed in the chat: a proposal is accepted only from its card (the replan route checks it
  // is still open). Answer deterministically from the stored state, and never search for «اقتراح».
  const typedProposalDecision = channel !== "call" && !activePendingChange && isProposalDecisionMessage(visitorMessage);
  const openProposal = typedProposalDecision
    ? await prisma.itinerary.findFirst({
      where: { sessionId: session.id, eventId: session.eventId, status: "proposed", OR: [{ proposalExpiresAt: null }, { proposalExpiresAt: { gt: new Date() } }] },
      select: { id: true },
    })
    : null;
  const decision: Awaited<ReturnType<typeof decide>> = typedProposalDecision
    ? { intent: "chat", tool: null, confidence: "high", needsClarification: false }
    : await decide(visitorMessage, site, currentPlan, profile, nowMin, storedContext, activePendingChange, previousAssistantTurn);
  const visitHistory = session.visitor ?? session.guestProfile;
  const guestSignal = visitHistory ? { visitedKeys: visitHistory.visitedKeys } : null;
  const guardTopic = decision.intent === "chat" ? guardrailTopic(visitorMessage) : null;
  if (pendingChange) {
    contextToPersist = mergeAssistantContext(storedContext, { pendingStopChange: null });
    contextChanged = true;
  }

  let answer = "أقدر أبحث لك عن نشاط، أو أشرح مسارك، أو أعدّله حسب وقتك ومزاجك.";
  let sources: Array<Record<string, unknown>> = [];
  let warnings: Array<Record<string, unknown>> = [];
  let updatedPlan: ReturnType<typeof toEngineItinerary> | null = null;
  let assistantResultType = "ANSWER";
  let itineraryId = latest?.id ?? null;
  let handoffId: string | null = null;
  let clarifyOptions: Array<{ id: string; name: string }> = [];
  // Names the rewritten reply must keep (the stops dropped because the youngest child is too young).
  let profileMentions: string[] = [];
  let directionsBrief: WalkingBrief | null = null;
  // "alternatives" changes nothing, but must skip cancelled or delayed activities like a real swap.
  const canChangePlan = ["build", "shorten", "remove", "swap", "add", "profile", "alternatives"].includes(decision.intent);
  const live = canChangePlan
    ? await activeLiveEvents(session.eventId, session.catalogVersionId, new Date(), nowMin)
    : null;
  const blockedActivities = live?.events.flatMap((event) => event.type === "cancel" || event.type === "delay" ? [event.activity] : []) ?? [];
  const planningProfile = { ...profile, avoid: [...new Set([...profile.avoid, ...blockedActivities])] };
  let proposalPayload: {
    id: string;
    candidate: ReturnType<typeof toEngineItinerary>;
    baseItineraryId: string;
    baseLiveRevision: string;
    proposalExpiresAt: string | null;
    diff: ReturnType<typeof diffPlans>;
  } | null = null;

  if (typedProposalDecision) {
    const english = prefersEnglish(visitorMessage);
    answer = openProposal
      ? english
        ? "The proposal is still waiting on its card. Tap accept there to apply it; I can't apply it from the chat."
        : "الاقتراح ما زال بانتظارك في بطاقته. اضغط زر الاعتماد في البطاقة عشان يتطبّق، أنا ما أطبّقه من المحادثة."
      : english
        ? "That proposal is no longer available, so nothing was changed. Tell me what you'd like and I'll prepare a new one."
        : "ما عاد هذا الاقتراح متاحًا، وما تغيّر شيء في مسارك. قل لي وش تبي وأجهز لك اقتراحًا جديدًا.";
    assistantResultType = "ANSWER";
  } else if (decision.intent === "build") {
    if (live) site.applyEvents(live.events.filter((event) => event.type === "crowd_spike" && site.zones.has(event.zone)), nowMin);
    updatedPlan = buildRoute(site, planningProfile);
    sources = sourceRowsForPlan(updatedPlan, site, session.catalogVersionId);
    answer = updatedPlan.stops.length
      ? `بنيت لك مسارًا جديدًا من ${stationsCount(updatedPlan.stops.length)} حسب تفضيلاتك، وتقدر تطلب مني أهدأ أو أرخص أو أقصر.`
      : "ما قدرت أبني مسارًا صالحًا من الكتالوج المنشور ضمن الوقت والقيود الحالية.";
    assistantResultType = "TOOL_RESULT";
  } else if (decision.intent === "profile") {
    // «عيالي أعمارهم 5 و 9»: remember the group details, then re-plan as a proposal the visitor approves.
    const details = parsePartyDetails(visitorMessage)!;
    const stored = session.preferences;
    const youngestChildAge = details.youngestChildAge ?? stored?.youngestChildAge ?? null;
    // «عيالي أعمارهم 5 و 9» means the children plus the adults already known (two for a family).
    const impliedSize = details.childAges.length + Math.max(1, planningProfile.companions_adults);
    const partySize = details.partySize ?? Math.max(stored?.partySize ?? 1, impliedSize);
    await prisma.visitorPreference.upsert({
      where: { sessionId: session.id },
      update: { partySize, youngestChildAge },
      create: { sessionId: session.id, partySize, youngestChildAge, interests: [] },
    });
    // A registered visitor's next visit starts from what they told the assistant today.
    if (session.visitor?.id) await mergeVisitorPreferences(session.visitor.id, { partySize, youngestChildAge }).catch(() => {});
    const groupProfile = {
      ...planningProfile,
      party_size: partySize,
      youngest_child_age: youngestChildAge,
      companions_kids: planningProfile.companions_kids || youngestChildAge != null,
    };
    const wanted = namedActivity(visitorMessage, site);
    if (wanted) groupProfile.must_include = [...new Set([...groupProfile.must_include, wanted])];
    const tooYoungFor = youngestChildAge == null ? [] : (currentPlan?.stops ?? [])
      .filter((stop) => stop.start > nowMin && (site.activities.get(stop.act_id)?.min_age ?? 0) > youngestChildAge)
      .map((stop) => stop.name);
    profileMentions = tooYoungFor;
    if (live) site.applyEvents(live.events.filter((event) => event.type === "crowd_spike" && site.zones.has(event.zone)), nowMin);
    const rebuilt = buildRoute(site, groupProfile);
    const upcomingIds = (plan: { stops: { act_id: string; start: number }[] } | null) =>
      (plan?.stops ?? []).filter((stop) => stop.start > nowMin).map((stop) => stop.act_id).join(",");
    // Nothing to propose when the current plan already suits the group.
    const unchanged = Boolean(currentPlan) && upcomingIds(rebuilt) === upcomingIds(currentPlan);
    updatedPlan = unchanged ? null : rebuilt;
    sources = sourceRowsForPlan(updatedPlan ?? currentPlan, site, session.catalogVersionId);
    const noted = [
      youngestChildAge != null ? `أصغر طفل عمره ${arabicYears(youngestChildAge)}` : null,
      `عددكم ${partySize}`,
    ].filter(Boolean).join(" و");
    const wantedName = wanted ? site.activities.get(wanted)?.name : undefined;
    const wantedNote = wantedName
      ? rebuilt.stops.some((stop) => stop.act_id === wanted)
        ? unchanged ? ` و«${wantedName}» موجود في مسارك.` : ` وضمّنت «${wantedName}».`
        : ` وما قدرت أدخل «${wantedName}» ضمن الوقت أو الميزانية أو عمر الأطفال.`
      : "";
    answer = `سجّلت إن ${noted}، وأحسب الأسعار على الكل.`
      + (tooYoungFor.length ? ` «${tooYoungFor.join("» و«")}» ما تناسب عمر أصغر طفل، فشلتها.` : "")
      + (unchanged ? " مسارك الحالي يناسبكم كما هو." : latest ? " جهزت لك اقتراح مسار يناسبكم، والقرار لك." : " وبنيت لك مسارًا يناسبكم.")
      + wantedNote;
    assistantResultType = "TOOL_RESULT";
  } else if (decision.intent === "search") {
    const ranked = searchActivities(visitorMessage, site, profile, session.catalogVersionId, guestSignal);
    // متابعة مثل «وكم سعرها؟» بعد ترشيح: النشاط المرشح سابقًا يتصدر النتائج.
    const asksDetail = /سعر|بكم|كم|متى|موعد|مواعيد|مد[ته]|عمر|يفتح|يبدا|يبدأ|price|when|how much|cost/i.test(visitorMessage);
    // «متى يفتح عرض الدلافين؟» is the dolphinarium: the same approximate match the directions tool uses.
    const namesActivity = findActivityTarget(visitorMessage, site, null, nowMin, null, new Set(site.activities.keys()))
      ?? (asksDetail ? fuzzyActivityTarget(visitorMessage, site) : null);
    // «كم سعر الغواصة؟» in an event with no submarine: say so, and never price a different activity —
    // not even the last suggestion, which only a real follow-up («وكم سعرها؟») refers back to.
    const missingSubject = namesActivity ? null : unmatchedDetailSubject(visitorMessage, site);
    const followUpId = asksDetail && !missingSubject ? namesActivity ?? storedContext?.lastSuggestedActivityId : undefined;
    const focus = followUpId ? site.activities.get(followUpId) : undefined;
    const searchResults = focus
      ? [
        { ...sourceForActivity(focus, session.catalogVersionId), zoneName: site.zones.get(focus.zone)?.name ?? focus.zone, reasons: [namesActivity ? "النشاط اللي سألت عنه" : "النشاط اللي كنا نتكلم عنه"] },
        ...ranked.filter((source) => source.id !== focus.id).slice(0, 3),
      ]
      : (() => {
        // A recommendation offers something new; stops already in the route only show when nothing else is left.
        if (!isRecommendationQuery(visitorMessage) || /متى|مواعيد|وقت|يفتح|يبدأ|schedule/i.test(visitorMessage)) return ranked;
        // Rank without the planned stops, not filter the top five: a full plan can hold all five.
        const inRoute = new Set(currentPlan?.stops.map((stop) => stop.act_id) ?? []);
        const fresh = inRoute.size ? searchActivities(visitorMessage, site, profile, session.catalogVersionId, guestSignal, inRoute) : ranked;
        return fresh.length ? fresh : ranked;
      })();
    sources = searchResults;
    const asksSchedule = /متى|مواعيد|وقت|يفتح|يبدأ|schedule/i.test(visitorMessage);
    const focusSource = focus ? searchResults[0] : null;
    answer = missingSubject
      ? prefersEnglish(visitorMessage)
        ? `«${missingSubject}» isn't in this event's published listings, so I have no price or time for it. Here are some options that are; ask the info desk if you saw it somewhere.`
        : `ما لقيت «${missingSubject}» في قائمة أنشطة هذي الفعالية، فما عندي له سعر ولا موعد. هذي خيارات موجودة فعلًا، ولو شفته في مكان اسأل نقطة المعلومات.`
      : focusSource
      ? `«${focusSource.name}» في ${focusSource.zoneName}: ${focusSource.priceSar == null ? "السعر غير مذكور في الكتالوج" : focusSource.priceSar === 0 ? "مجانية" : `حوالي ${focusSource.priceSar} ريال للشخص`}، مدتها ${minutesText(focusSource.durationMin)}، ومواعيدها ${formatSchedule(focusSource.schedule)}.`
      : sources.length
      ? !asksSchedule && isRecommendationQuery(visitorMessage)
        ? prefersEnglish(visitorMessage)
          // The fallback draft must already be in the visitor's language if a rewrite is rejected.
          ? `I'd suggest «${searchResults[0].name}» in ${searchResults[0].zoneName ?? searchResults[0].zone}. The reasons and other options are on the cards.`
          : `أرشّح لك «${searchResults[0].name}» في ${searchResults[0].zoneName ?? searchResults[0].zone}. بتلقى سبب الترشيح وباقي الخيارات في البطاقات.`
        : prefersEnglish(visitorMessage)
        ? `I found ${sources.length} options, including ${searchResults.slice(0, 2).map((source) => `«${source.name}» in ${source.zoneName ?? source.zone}${asksSchedule ? ` (${formatSchedule(source.schedule)})` : ""}`).join(" and ")}.`
        : `لقيت لك ${sources.length} من الخيارات: ${searchResults.slice(0, 2).map((source) => `${source.name} في ${source.zoneName ?? source.zone}${asksSchedule ? ` (${formatSchedule(source.schedule)})` : ""}`).join("، ")}.`
      : "ما لقيت لك خيار يطابق طلبك في الكتالوج الحالي.";
    assistantResultType = "TOOL_RESULT";
    contextToPersist = mergeAssistantContext(contextToPersist, {
      lastSearchIds: searchResults.map((source) => source.id),
      lastSuggestedActivityId: searchResults[0]?.id,
    });
    contextChanged = true;
  } else if (decision.intent === "location") {
    let location = decision.locationId ? site.locations.get(decision.locationId) : null;
    // «وين أقرب دورة مياه؟» means the nearest one of that kind, not the best name match: among open
    // services sharing the matched one's aliases (toilets, prayer rooms…), pick the shortest walk.
    if (location?.type === "SERVICE") {
      const origin = likelyOrigin(site, currentPlan?.stops ?? [], nowMin, session.preferences?.startPointId);
      const kind = new Set(location.aliases);
      const sameKind = [...site.locations.values()].filter((candidate) => candidate.type === "SERVICE" && candidate.status === "open"
        && candidate.zone && candidate.aliases.some((alias) => kind.has(alias)));
      if (origin && sameKind.length > 1) {
        location = sameKind.sort((a, b) => site.travelMin(origin.zone, a.zone!) - site.travelMin(origin.zone, b.zone!))[0];
      }
    }
    // الأداة: مسار مشي محسوب من رسم الممرات + الزحام الحي (المساعد يصيغ فقط)
    const briefFor = async (target: { id: string; name: string; zone?: string | null; nodeId: string | null }) => {
      const origin = likelyOrigin(site, currentPlan?.stops ?? [], nowMin, session.preferences?.startPointId);
      if (!origin || !target.zone) return null;
      const snapshots = await loadCurrentCrowdSnapshots(prisma, session.eventId, session.catalogVersionId, new Date()).catch(() => []);
      const levels = new Map(snapshots.filter((snapshot) => snapshot.source !== "SIMULATED" || snapshot.eventUpdate).map((snapshot) => [snapshot.zone.stableKey, snapshot.level]));
      return walkingBrief(site, { originZone: origin.zone, originSource: origin.source, targetId: target.id, targetName: target.name, targetNodeId: target.nodeId, targetZone: target.zone }, levels);
    };
    if (location) {
      sources = [sourceForLocation(location, site, session.catalogVersionId)];
      directionsBrief = location.status === "open"
        ? await briefFor({ id: location.id, name: location.label, zone: location.zone, nodeId: site.routeGraphNodes.has(location.id) ? location.id : null })
        : null;
      answer = location.status !== "open"
        ? `موقع «${location.label}»${location.zone ? ` في ${site.zones.get(location.zone)?.name ?? location.zone}` : ""}، لكن الكتالوج يشير إلى أنه غير مفتوح حاليًا.`
        : directionsBrief
          ? `«${location.label}»${location.zone ? ` في ${site.zones.get(location.zone)?.name ?? location.zone}` : ""}. ${describeWalkingBrief(directionsBrief)}`
          : `موقع «${location.label}»${location.zone ? ` في ${site.zones.get(location.zone)?.name ?? location.zone}` : " ظاهر على الخريطة"}. اضغط «اتجاهات» عشان أدلّك عليه.`;
      assistantResultType = "TOOL_RESULT";
      contextToPersist = mergeAssistantContext(contextToPersist, { lastLocationIds: [location.id] });
      contextChanged = true;
    } else {
      sources = namedDirectionTargets(visitorMessage, site, session.catalogVersionId);
      if (!sources.length) {
        // اسم نشاط تقريبي («عرض الدلافين») → نفس مطابقة الأنشطة المستخدمة في التعديل
        const activityId = findActivityTarget(visitorMessage, site, null, nowMin, null, new Set(site.activities.keys()))
          ?? fuzzyActivityTarget(visitorMessage, site);
        const activity = activityId ? site.activities.get(activityId) : undefined;
        if (activity) sources = [{ ...sourceForActivity(activity, session.catalogVersionId), zoneName: site.zones.get(activity.zone)?.name ?? activity.zone }];
      }
      if (sources.length === 1) {
        const only = sources[0] as { kind?: string; id: string; name: string; zone?: string };
        const zone = only.kind === "zone" ? only.id : only.kind === "activity" ? site.activities.get(only.id)?.zone : site.routeGraphNodes.get(only.id)?.zone;
        directionsBrief = await briefFor({ id: only.id, name: only.name, zone, nodeId: only.kind === "location" && site.routeGraphNodes.has(only.id) ? only.id : null });
      }
      answer = sources.length === 1
        ? directionsBrief ? describeWalkingBrief(directionsBrief) : `لقيت «${sources[0].name}» في الكتالوج. اضغط «اتجاهات» لاختيار نقطة الانطلاق.`
        : sources.length ? "لقيت أكثر من وجهة مطابقة. اختر الوجهة من البطاقات."
        : "ما قدرت أحدد الوجهة. اكتب اسم النشاط أو المنطقة أو الخدمة، أو اخترها من قائمة الاتجاهات.";
      assistantResultType = sources.length ? "TOOL_RESULT" : "CLARIFICATION";
    }
  } else if (decision.intent === "schedule") {
    // get_schedule: timed sessions from the published catalog, soonest first; nothing is guessed.
    const soon = upcomingSchedule(site, profile, nowMin, 120);
    const entries = soon.length ? soon : upcomingSchedule(site, profile, nowMin, 360);
    sources = entries.map(({ activity, start }) => ({
      ...sourceForActivity(activity, session.catalogVersionId),
      zoneName: site.zones.get(activity.zone)?.name ?? activity.zone,
      nextStartsAt: clockText(start),
      reasons: [`يبدأ ${clockText(start)}`],
    }));
    const english = prefersEnglish(visitorMessage);
    const listed = entries.slice(0, 3).map(({ activity, start }) => `${clockText(start)} «${activity.name}» ${english ? "in" : "في"} ${site.zones.get(activity.zone)?.name ?? activity.zone}`);
    answer = entries.length
      ? english
        ? `${soon.length ? "Starting in the next two hours" : "The next timed sessions"}: ${listed.join(", ")}.`
        : `${soon.length ? "اللي يبدأ خلال الساعتين الجاية" : "أقرب العروض بمواعيد"}: ${listed.join("، ")}.`
      : english
        ? "No timed sessions are left in your visit. Open activities run the whole time, and I can suggest one."
        : "ما فيه عروض بمواعيد محددة باقي وقت زيارتك. الأنشطة المفتوحة متاحة طول الوقت، وأقدر أرشّح لك منها.";
    assistantResultType = "TOOL_RESULT";
    if (entries.length) {
      contextToPersist = mergeAssistantContext(contextToPersist, { lastSearchIds: entries.map(({ activity }) => activity.id), lastSuggestedActivityId: entries[0].activity.id });
      contextChanged = true;
    }
  } else if (decision.intent === "alternatives") {
    // list_alternatives: options only. Picking one sends a named swap, which is still a proposal.
    const target = decision.targetId ? site.activities.get(decision.targetId) : undefined;
    if (!currentPlan || !target) {
      answer = currentPlan ? "ما عندك محطات جاية أعرض لها بدائل." : "نبني لك المسار أولًا، وبعدها أعرض لك بدائل أي محطة.";
      assistantResultType = "CLARIFICATION";
    } else {
      const options = listAlternatives(site, planningProfile, currentPlan, target.id, nowMin, decision.preferenceHint, decision.moodHint);
      sources = options.map(({ activity, reasons }) => ({
        ...sourceForActivity(activity, session.catalogVersionId),
        zoneName: site.zones.get(activity.zone)?.name ?? activity.zone,
        reasons,
        swapFor: target.id,
        swapForName: target.name,
      }));
      const names = options.map(({ activity }) => `«${activity.name}»`);
      answer = prefersEnglish(visitorMessage)
        ? options.length
          ? `Instead of «${target.name}», these fit your time: ${names.join(" or ")}. Pick one on its card and I'll prepare a swap proposal; your plan only changes if you approve it.`
          : `Nothing else fits in place of «${target.name}» with the same time and budget. I can remove it and reorder the rest if you like.`
        : options.length
          ? `بدل «${target.name}» يدخل في وقتك ${names.join(" أو ")}. اختر من البطاقات وأجهز لك اقتراح التبديل، ومسارك ما يتغيّر إلا بموافقتك.`
          : `ما لقيت بديل يدخل مكان «${target.name}» بنفس الوقت والميزانية. أقدر أشيلها وأعيد ترتيب الباقي إذا تبي.`;
      assistantResultType = "TOOL_RESULT";
      if (options.length) {
        contextToPersist = mergeAssistantContext(contextToPersist, { lastSearchIds: options.map(({ activity }) => activity.id), lastSuggestedActivityId: options[0].activity.id });
        contextChanged = true;
      }
    }
  } else if (decision.intent === "status") {
    const next = describeNextStop(currentPlan, nowMin);
    sources = sourceRowsForPlan(currentPlan, site, session.catalogVersionId);
    answer = next
      ? `محطتك التالية «${next.name}» الساعة ${String(Math.floor(next.start / 60)).padStart(2, "0")}:${String(next.start % 60).padStart(2, "0")}. عندك ${stationsCount(currentPlan?.stops.length ?? 0)} في المسار.`
      : "ما عندك مسار محفوظ حتى الآن. جاوبني عن وقتك واهتماماتك لأبنيه لك.";
    assistantResultType = "TOOL_RESULT";
  } else if (decision.intent === "crowd") {
    const snapshots = await loadCurrentCrowdSnapshots(prisma, session.eventId, session.catalogVersionId, new Date());
    const measured = snapshots.filter(isMeasuredCrowd);
    sources = crowdSourceRows(measured, site, currentPlan, nowMin, catalogResult.demoNavigation);
    const crowded = sources.filter((source) => Number(source.level) >= site.crowdThreshold);
    const status = !measured.length
      ? sources.length ? "هذه تقديرات من العرض التجريبي." : "ما عندي قياسات زحام مباشرة الحين."
      : crowded.length
        ? `القياسات الحالية تشير إلى إشغال مرتفع في ${crowded.map((source) => source.zoneName).join("، ")}.`
        : "القياسات الحالية أقل من حد الإشغال المرتفع في المناطق المقاسة.";
    // Always end with something the visitor can do: two quieter options that fit them, ranked by the
    // planner's crowd forecast for this hour (labelled as a forecast), shown as cards they can add or swap in.
    const planned = new Set(currentPlan?.stops.map((stop) => stop.act_id) ?? []);
    const busyZones = new Set(crowded.map((source) => source.zone));
    const quieter = searchActivities("أهدى أقل زحام", site, profile, session.catalogVersionId, guestSignal)
      .filter((row) => !planned.has(row.id) && !busyZones.has(row.zone))
      .slice(0, 2);
    if (quieter.length) {
      sources = [...sources, ...quieter];
      const names = quieter.map((row) => `«${row.name}» في ${row.zoneName ?? row.zone}`).join(" و");
      answer = `${status} حسب توقع الزحام لهذا الوقت، أهدى خيارات تناسبك: ${names}. تبيني أضيف واحد منها أو أبدّل فيه محطتك الجاية؟`;
    } else {
      answer = `${status} أقدر أساعدك تلقى نقطة خدمة الزوار.`;
    }
    warnings = sources.filter((source) => source.source === "simulated").map((source) => ({ code: "SIMULATED_LIVE_DATA", zone: source.zone }));
    assistantResultType = "TOOL_RESULT";
  } else if (decision.intent === "explain") {
    const target = decision.targetId ? site.activities.get(decision.targetId) : undefined;
    const targetStop = target && currentPlan?.stops.find((stop) => stop.act_id === target.id);
    const constraints = [
      profile.duration_min ? `${minutesText(profile.duration_min)} متاحة` : null,
      profile.budget != null ? `ميزانية ${profile.budget} ريال` : "بدون حد ميزانية محدد",
      profile.mood ? `مزاج ${profile.mood}` : null,
      profile.interests.length ? `اهتماماتك (${profile.interests.join("، ")})` : null,
    ].filter((value): value is string => Boolean(value));
    sources = target ? [sourceForActivity(target, session.catalogVersionId)] : sourceRowsForPlan(currentPlan, site, session.catalogVersionId);
    if (target && targetStop) {
      const matches = target.interests.filter((interest) => profile.interests.includes(interest));
      const moodMatch = profile.mood && target.moods.includes(profile.mood);
      answer = `اخترت «${target.name}» لأنها ضمن مسارك بعد حساب ${constraints.join("، ")}${matches.length ? `، وتطابق اهتمامك بـ${matches.join(" و")}` : ""}${moodMatch ? "، ومناسبة لمزاجك" : ""}.`;
    } else if (currentPlan?.stops.length) {
      const next = describeNextStop(currentPlan, nowMin);
      answer = `بنيت المسار على ${constraints.join("، ")}، مع حساب وقت المشي والانتظار والزحام من الكتالوج المنشور. محطتك التالية «${next?.name ?? currentPlan.stops[0].name}».`;
    } else {
      answer = "أقدر أشرح الاختيار بعد بناء المسار. جاوبني عن وقتك وميزانيتك واهتماماتك أولًا.";
    }
  } else if (guardTopic) {
    // الهوية وكشف التعليمات: رد ثابت لا يمر على النموذج أبدًا.
    answer = guardrailReply(guardTopic, prefersEnglish(visitorMessage));
    assistantResultType = "ANSWER";
  } else if (decision.intent === "chat") {
    // سوالف: رد حتمي احتياطي، وترشيحات شخصية من الكتالوج كحقائق وحيدة مسموح بها للنموذج.
    answer = chatReply(redactConversationText(visitorMessage));
    sources = searchActivities("", site, profile, session.catalogVersionId, guestSignal).slice(0, 3);
    assistantResultType = "ANSWER";
  } else if (decision.intent === "faq") {
    // Venue facts come from the published catalog; anything it doesn't hold is said plainly, never guessed.
    const hhmm = (value: number) => {
      const minute = value < 100 ? value * 60 : value;
      return `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    };
    const opening = catalogResult.catalog.site.opening;
    const lines: string[] = [];
    for (const topic of venueFaqTopics(visitorMessage)) {
      if (topic === "hours") lines.push(`حسب بيانات الفعالية المنشورة، المواعيد من ${hhmm(opening.from)} إلى ${hhmm(opening.to)}.`);
      if (topic === "tickets") {
        lines.push("سعر تذكرة الدخول مو موجود في بيانات الفعالية اللي عندي، وما أبي أعطيك رقم غير مؤكد. شوف قناة الحجز الرسمية للفعالية.");
      }
      if (topic === "weather") {
        const anchor = catalogResult.navigation.calibration;
        const weather = await venueWeather(eventSlug, anchor ? { lat: anchor.anchorLat, lng: anchor.anchorLng } : null, nowMin);
        lines.push(weather
          ? weather.live ? `الجو في الموقع الحين: ${weather.summaryAr}` : `ما وصلتني قراءة طقس حية الحين. ${weather.summaryAr}`
          : "ما عندي بيانات طقس لهذه الفعالية.");
        if (weather?.live) sources = [...sources, { kind: "weather", name: "Open-Meteo", temperatureCelsius: weather.temperatureCelsius, condition: weather.condition, observedAt: weather.at, sourceRef: "weather:open-meteo" }];
      }
    }
    const infoDesk = venueFaqTopics(visitorMessage).some((topic) => topic !== "weather")
      ? [...site.locations.values()].find((location) => location.status === "open" && location.aliases?.some((alias) => alias.includes("معلومات")))
      : undefined;
    if (infoDesk) {
      sources = [sourceForLocation(infoDesk, site, session.catalogVersionId)];
      lines.push(`ولأي تأكيد، «${infoDesk.label}» تساعدك.`);
    }
    // The hours in the answer get a source row too, so every number in the reply is traceable.
    if (venueFaqTopics(visitorMessage).includes("hours")) {
      sources = [...sources, { kind: "venue", name: site.venueName, openingFrom: hhmm(opening.from), openingTo: hhmm(opening.to), sourceRef: `catalog:${session.catalogVersionId}/site:opening` }];
    }
    answer = lines.join(" ");
    assistantResultType = "ANSWER";
  } else if (decision.intent === "help") {
    answer = isLostChild(visitorMessage)
      ? "توجّه الآن لأقرب موظف أمن أو نقطة معلومات وأعطهم وصف الطفل ولبسه. رفعت بلاغك لغرفة العمليات كأولوية."
      : "أفهم أن عندك مشكلة. رفعت طلبك للمشغّل مع إخفاء بيانات الاتصال الحساسة، وبيتابعونه من غرفة العمليات.";
    assistantResultType = "HANDOFF";
  } else if (decision.intent === "shorten" || decision.intent === "remove" || decision.intent === "swap" || decision.intent === "add") {
    if (!currentPlan) {
      answer = decision.intent === "add"
        ? "نبني لك المسار أولًا، وبعدها أقدر أضيف نشاطًا بعد التحقق من الوقت والميزانية."
        : "نبني لك المسار أولًا، وبعدها أقدر أشيل أو أبدّل أي محطة.";
      assistantResultType = "CLARIFICATION";
    } else if (decision.needsClarification) {
      const options = decision.ambiguousTargetIds?.slice(0, 3).flatMap((id) => {
        const activity = site.activities.get(id);
        return activity ? [sourceForActivity(activity, session.catalogVersionId)] : [];
      }) ?? [];
      clarifyOptions = options.map((option) => ({ id: option.id, name: option.name }));
      answer = options.length
        ? `تقصد «${options.map((option) => option.name).join("» أو «")}»؟`
        : decision.intent === "add" ? "وش النشاط اللي تبي أضيفه؟"
          : decision.intent === "remove" ? "وش المحطة اللي تبي أشيلها؟"
          : "وش المحطة اللي تبي أبدّلها؟";
      if (latest && (decision.intent === "swap" || decision.intent === "remove")) {
        contextToPersist = mergeAssistantContext(contextToPersist, { pendingStopChange: {
          itineraryId: latest.id,
          intent: decision.intent,
          moodHint: decision.moodHint,
          preferenceHint: decision.preferenceHint,
        } });
        contextChanged = true;
      }
      assistantResultType = "CLARIFICATION";
    } else {
      const modification = applyAgentModification(decision, site, planningProfile, structuredClone(currentPlan), nowMin, live?.events);
      updatedPlan = modification.plan;
      const addSucceeded = decision.intent !== "add" || Boolean(decision.targetId && updatedPlan?.stops.some((stop) => stop.act_id === decision.targetId));
      if (!updatedPlan || !addSucceeded) {
        updatedPlan = null;
        const addRefusal = ("reason" in modification ? modification.reason : undefined)
          ?? modification.plan?.explanations.slice(currentPlan?.explanations.length ?? 0).find((line) => line.startsWith("ما قدرت أضيف «"));
        answer = decision.intent === "add"
          ? addRefusal ?? "ما قدرت أضيف النشاط ضمن الوقت أو الميزانية. اذكر اسم نشاط من الخيارات المعروضة أو اطلب تقصير الجولة أولًا."
          : ("reason" in modification ? modification.reason : undefined) ?? "ما قدرت أحدد النشاط المطلوب. اذكر اسمه أو قل لي مثلًا: «بدّل أول محطة».";
        assistantResultType = "CLARIFICATION";
      } else if (decision.intent === "shorten") {
        answer = "جهزت لك اقتراح لجولة أخف، وخليت المحطات اللي بدأت أو قرب وقتها. راجعه وطبّقه إذا ناسبك.";
      } else if (decision.intent === "remove") {
        const targetName = decision.targetId ? site.activities.get(decision.targetId)?.name : undefined;
        answer = targetName ? `جهزت اقتراحًا يشيل «${targetName}» ويعيد ترتيب ما بعدها. القرار لك.` : "جهزت اقتراحًا يشيل المحطة المطلوبة ويعيد ترتيب ما بعدها. القرار لك.";
      } else if (decision.intent === "add") {
        const targetName = decision.targetId ? site.activities.get(decision.targetId)?.name : undefined;
        const droppedNames = ("droppedIds" in modification ? modification.droppedIds ?? [] : []).map((id) => site.activities.get(id)?.name ?? id);
        answer = targetName && droppedNames.length
          ? `مسارك مليان، فجهزت اقتراحًا يضيف «${targetName}» مكان «${droppedNames.join("» و«")}» عشان يدخل في وقتك وميزانيتك. القرار لك.`
          : targetName ? `جهزت اقتراحًا يضيف «${targetName}» بعد التحقق من الوقت والميزانية. طبّقه إذا ناسبك.` : "جهزت اقتراحًا يضيف النشاط بعد التحقق من الوقت والميزانية. طبّقه إذا ناسبك.";
      } else if (modification.replacementId) {
        const oldName = decision.targetId ? site.activities.get(decision.targetId)?.name : "المحطة";
        const replacementName = site.activities.get(modification.replacementId)?.name ?? "بديل مناسب";
        answer = `أقترح تبديل «${oldName}» بـ«${replacementName}» مع الحفاظ على وقت الجولة قدر الإمكان. ما راح أغيّر مسارك إلا بموافقتك.`;
      } else {
        answer = "ما لقيت بديلًا مناسبًا بنفس القيود، فجهزت اقتراحًا يستبعد المحطة ويعيد ترتيب المسار. القرار لك.";
      }
      sources = sourceRowsForPlan(updatedPlan, site, session.catalogVersionId);
    }
  } else {
    answer = "وضح لي وش في بالك شوي. تبي ترشيح، اتجاهات، أو تغيير في مسارك؟";
    assistantResultType = "CLARIFICATION";
  }

  if (updatedPlan && latest && decision.intent === "build") {
    answer = `جهزت لك اقتراح مسار جديد من ${stationsCount(updatedPlan.stops.length)} حسب تفضيلاتك. راجعه وطبّقه إذا ناسبك؛ مسارك الحالي ما تغيّر.`;
  }

  // ————— الصياغة الشخصية: المحرك قرّر، والنموذج يصيغ لهذا الزائر تحديدًا ثم يُفحص الإسناد —————
  const proposalPending = Boolean(updatedPlan && latest);
  const pendingDiff = proposalPending && currentPlan && updatedPlan ? diffPlans(currentPlan, updatedPlan) : null;
  // The sentence must describe the engine's actual change. If the named stop is not the one that
  // leaves the plan (it already started, or the replan reshuffled), describe the diff itself.
  if (pendingDiff && (decision.intent === "swap" || decision.intent === "remove")) {
    const targetLeaves = Boolean(decision.targetId && pendingDiff.removed.some((item) => item.id === decision.targetId));
    const alsoRemoves = pendingDiff.removed.some((item) => item.id !== decision.targetId);
    const expectedAdds = decision.intent === "swap" ? 1 : 0;
    // Every activity the draft names must really be in the diff (or a stop that stays).
    const inDiff = new Set([...pendingDiff.added, ...pendingDiff.removed].map((item) => item.name));
    const draftNamesOk = [...answer.matchAll(/«([^»]+)»/g)].every((match) => inDiff.has(match[1]));
    if (!targetLeaves || alsoRemoves || pendingDiff.added.length !== expectedAdds || !draftNamesOk) {
      const quote = (items: Array<{ name: string }>) => items.map((item) => `«${item.name}»`).join(" و");
      const keptName = !targetLeaves && decision.targetId ? site.activities.get(decision.targetId)?.name : undefined;
      answer = [
        keptName && currentPlan?.stops.some((stop) => stop.act_id === decision.targetId) ? `«${keptName}» باقية لأن وقتها بدأ أو قرب.` : null,
        pendingDiff.added.length || pendingDiff.removed.length
          ? `جهزت اقتراحًا${pendingDiff.added.length ? ` يضيف ${quote(pendingDiff.added)}` : ""}${pendingDiff.added.length && pendingDiff.removed.length ? "،" : ""}${pendingDiff.removed.length ? ` ويشيل ${quote(pendingDiff.removed)}` : ""}.`
          : "جهزت اقتراحًا يعيد ترتيب المواعيد.",
        "ما راح يتغيّر مسارك إلا بموافقتك.",
      ].filter(Boolean).join(" ");
    }
  }
  if (pendingDiff && decision.intent !== "build" && decision.intent !== "profile" && pendingDiff.added.length + pendingDiff.removed.length > 2 && !answer.includes("يشيل «")) {
    answer = `${answer} الاقتراح يغيّر محطات ثانية بعد، وكل التغييرات في البطاقة تحت.`;
  }
  const visitorBrief = buildVisitorBrief({
    site,
    profile,
    preferences: session.preferences,
    plan: currentPlan,
    nowMin,
    visitedKeys: session.visitor?.visitedKeys ?? session.guestProfile?.visitedKeys,
    visitCount: session.visitor?.id ? await visitorVisitCount(session.visitor.id).catch(() => 0) : 0,
  });
  const nextAfter = describeNextStop(updatedPlan ?? currentPlan, nowMin);
  const facts = {
    النتيجة: assistantResultType,
    البيانات: compactSources(sources),
    ...(warnings.length ? { تنبيهات: "بيانات الزحام تقديرية من العرض التجريبي" } : {}),
    ...(pendingDiff ? { اقتراح_بانتظار_موافقة_الزائر: { يضيف: pendingDiff.added.map((item) => item.name), يشيل: pendingDiff.removed.map((item) => item.name), يغير_موعد: pendingDiff.moved.map((item) => item.name) } } : {}),
    ...(updatedPlan && !latest ? { مسار_جديد_محفوظ: updatedPlan.stops.map((stop) => `${String(Math.floor(stop.start / 60)).padStart(2, "0")}:${String(stop.start % 60).padStart(2, "0")} ${stop.name}`) } : {}),
    ...(nextAfter ? { المحطة_التالية: nextAfter.name } : {}),
    ...(directionsBrief ? { اتجاهات_المشي: { من: directionsBrief.originName, إلى: directionsBrief.targetName, دقائق_المشي: directionsBrief.totalWalkMin, مرورًا_بـ: directionsBrief.via, تجنبنا_زحمة: directionsBrief.avoided, زحمة_على_الطريق: directionsBrief.crowdedOnRoute } } : {}),
    ...(decision.intent === "help" ? { تحويل_للمشغل: "تم فتح بلاغ لفريق العمليات" } : {}),
  };
  const redactedMessage = redactConversationText(visitorMessage);
  // البلاغات والطوارئ تبقى بنصها الحتمي حرفيًا؛ ما نترك صياغتها للنموذج.
  if (channel !== "call" && decision.intent !== "help" && !typedProposalDecision && !guardTopic) {
    const composed = await composeReply({
      message: redactedMessage,
      draft: answer,
      // unknown = nothing ran; reply in persona (refuse extraction, redirect off-topic) under the same fact rules.
      kind: decision.intent === "chat" || decision.intent === "unknown" ? "chat" : "tool",
      intent: decision.intent,
      visitorBrief,
      facts,
      history,
      channel: channel === "voice" ? "voice" : "text",
      proposalPending,
      // Every stop a pending proposal removes must be named in the reply, not only in the card.
      mustMention: decision.intent === "profile" ? profileMentions
        : pendingDiff && decision.intent !== "build" ? [...pendingDiff.removed, ...pendingDiff.added].map((item) => item.name) : [],
      keptNames: pendingDiff && currentPlan ? currentPlan.stops.filter((stop) => !pendingDiff.removed.some((item) => item.id === stop.act_id)).map((stop) => stop.name) : [],
    });
    answer = composed.text;
  }
  rememberChatTurn(session.id, redactedMessage, answer);

  const retentionExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const contextData = contextChanged
    ? { assistantContext: contextToPersist ?? Prisma.JsonNull, assistantContextExpiresAt: contextToPersist ? contextExpiresAt() : null }
    : {};
  if (updatedPlan) {
    const stableKeys = updatedPlan.stops.map((stop) => stop.act_id);
    const dbActivities = await prisma.activity.findMany({
      where: { catalogVersionId: session.catalogVersionId, stableKey: { in: stableKeys } },
      select: { id: true, stableKey: true },
    });
    const dbActivityIds = new Map(dbActivities.map((activity) => [activity.stableKey, activity.id]));
    if (dbActivities.length !== stableKeys.length) return jsonError("CATALOG_INCOMPLETE", "بعض محطات المسار غير متاحة في الكتالوج المنشور.", 409);

    const base = new Date();
    const shouldPropose = Boolean(latest);
    if (shouldPropose) assistantResultType = "TOOL_RESULT";
    const proposalExpiresAt = shouldPropose ? new Date(Date.now() + 15 * 60_000) : null;
    const stored = await prisma.$transaction(async (tx) => {
      await tx.itinerary.updateMany({
        where: { sessionId: session.id, eventId: session.eventId, catalogVersionId: session.catalogVersionId, status: "proposed" },
        data: { status: "dismissed", decisionAt: new Date() },
      });
      const nextItinerary = await tx.itinerary.create({
        data: {
          sessionId: session.id,
          eventId: session.eventId,
          catalogVersionId: session.catalogVersionId,
          status: shouldPropose ? "proposed" : "active",
          generatedReason: `assistant_${decision.intent}`,
          baseItineraryId: shouldPropose ? latest!.id : null,
          baseLiveRevision: shouldPropose ? live!.liveRevision : null,
          proposalExpiresAt,
          totalCostCents: Math.round(updatedPlan!.total_cost * 100),
          totalWalkMin: updatedPlan!.stops.reduce((sum, stop) => sum + stop.walk_min, 0),
          totalWaitMin: updatedPlan!.stops.reduce((sum, stop) => sum + stop.wait_min, 0),
          items: {
            create: updatedPlan!.stops.map((stop, index) => ({
              activityId: dbActivityIds.get(stop.act_id)!,
              sequence: index,
              startsAt: dateForPlanMinute(base, profile.start_min, stop.start),
              endsAt: dateForPlanMinute(base, profile.start_min, stop.end),
              walkMin: stop.walk_min,
              waitMin: stop.wait_min,
              score: updatedPlan!.score,
              reasonCodes: stop.note ? [stop.note] : [],
              sourceRefs: [`catalog:${session.catalogVersionId}`, `assistant:${decision.intent}`],
            })),
          },
        },
      });
      await tx.conversationTurn.createMany({
        data: [
          { sessionId: session.id, role: "user", redactedContent: redactConversationText(visitorMessage), retentionExpiresAt },
          { sessionId: session.id, role: "assistant", redactedContent: answer, retentionExpiresAt },
        ],
      });
      await tx.assistantEvent.create({
        data: {
          sessionId: session.id,
          eventId: session.eventId,
          intent: decision.intent,
          toolName: decision.tool,
          resultType: assistantResultType as any,
          sourceCount: sources.length,
          latencyMs: Date.now() - startedAt,
        },
      });
      if (decision.intent === "help") {
        const handoff = await tx.visitorHandoff.create({
          data: {
            sessionId: session.id,
            eventId: session.eventId,
            category: "visitor_problem",
            redactedMessage: redactConversationText(visitorMessage),
          },
        });
        handoffId = handoff.id;
      }
      await tx.visitorSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date(), ...contextData } });
      return nextItinerary;
    });
    // A plan the assistant built directly is active now; a proposal is recorded when the visitor accepts it.
    if (!shouldPropose) await recordSessionPlan(session, stableKeys);
    if (shouldPropose && latest) {
      proposalPayload = {
        id: stored.id,
        candidate: updatedPlan,
        baseItineraryId: latest.id,
        baseLiveRevision: live!.liveRevision,
        proposalExpiresAt: proposalExpiresAt?.toISOString() ?? null,
        diff: diffPlans(currentPlan!, updatedPlan),
      };
      itineraryId = latest.id;
    } else {
      itineraryId = stored.id;
    }
  } else {
    await prisma.$transaction(async (tx) => {
      await tx.conversationTurn.createMany({
        data: [
          { sessionId: session.id, role: "user", redactedContent: redactConversationText(visitorMessage), retentionExpiresAt },
          { sessionId: session.id, role: "assistant", redactedContent: answer, retentionExpiresAt },
        ],
      });
      await tx.assistantEvent.create({
        data: {
          sessionId: session.id,
          eventId: session.eventId,
          intent: decision.intent,
          toolName: decision.tool,
          resultType: assistantResultType as any,
          sourceCount: sources.length,
          latencyMs: Date.now() - startedAt,
        },
      });
      if (decision.intent === "help") {
        const handoff = await tx.visitorHandoff.create({
          data: {
            sessionId: session.id,
            eventId: session.eventId,
            category: "visitor_problem",
            redactedMessage: redactConversationText(visitorMessage),
          },
        });
        handoffId = handoff.id;
      }
      await tx.visitorSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date(), ...contextData } });
    });
  }

  // A2UI v1.0 surface built from the engine result (never from model text), validated before it leaves.
  const surface = buildAssistantSurface({
    surfaceId: `wanees_${crypto.randomUUID().replace(/-/g, "")}`,
    intent: decision.intent,
    sources,
    planIds: new Set((currentPlan?.stops ?? []).map((stop) => stop.act_id)),
    proposal: proposalPayload ? {
      id: proposalPayload.id,
      added: proposalPayload.diff.added.map((item) => item.name),
      removed: proposalPayload.diff.removed.map((item) => item.name),
      moved: proposalPayload.diff.moved.map((item) => item.name),
    } : null,
    clarifyOptions,
    clarifyIntent: decision.intent,
    handoff: Boolean(handoffId),
  });
  const ui = surface && validateA2uiMessages(surface).length === 0 ? surface : null;

  return jsonData(request, {
      message: answer,
      ui,
      intent: decision.intent,
      tool: decision.tool,
      confidence: decision.confidence,
      needsClarification: decision.needsClarification,
      itineraryId,
      itinerary: proposalPayload ? null : updatedPlan,
      proposal: proposalPayload,
      next: describeNextStop(proposalPayload ? currentPlan : updatedPlan ?? currentPlan, nowMin),
      sources,
      warnings,
      directions: directionsBrief,
      handoff: handoffId ? { id: handoffId, status: "OPEN" } : null,
      clock,
      // للمكالمة الحية فقط: الحقائق المختصرة التي يُسمح للصوت أن ينطقها.
      ...(channel === "call" ? { facts } : {}),
    }, {
      persistence: "postgresql",
      catalogVersionId: session.catalogVersionId,
      generatedAt: new Date().toISOString(),
      retention: "conversation_turns_expire_after_24h",
    });
}

export async function GET(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  if (!getVisitorToken(request)) return jsonError("SESSION_TOKEN_REQUIRED", "يلزم رمز جلسة الزيارة.", 401);
  const session = await resolveVisitorSession(eventSlug, request);
  if (!session) return jsonError("SESSION_NOT_FOUND", "جلسة الزيارة غير موجودة أو انتهت.", 404);
  const turns = await prisma.conversationTurn.findMany({
    where: { sessionId: session.id, retentionExpiresAt: { gt: new Date() } },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: { id: true, role: true, redactedContent: true, createdAt: true },
  });
  return jsonData(request, turns.map((turn) => ({ ...turn, createdAt: turn.createdAt.toISOString() })), { persistence: "postgresql", retention: "conversation_turns_expire_after_24h" });
}
