import { hasStaleDelay, replan } from "@/engine/route.ts";
import { Site } from "@/engine/site.ts";
import type { CrowdEvent, Itinerary } from "@/engine/types.ts";
import { prisma } from "@/lib/db";
import { loadSessionCatalog } from "@/lib/db-catalog";
import { replanRequestSchema } from "@/lib/api-contracts";
import { toEngineItinerary, type StoredItinerary } from "@/lib/assistant";
import { getEventClock } from "@/lib/event-clock";
import { getVisitorToken, resolveVisitorSession } from "@/lib/visitor-auth";
import { resolveVisitWindow, visitNowMinute } from "@/lib/visitor-profile";
import { enforceRateLimit } from "@/lib/rate-limit";
import { jsonData, jsonError as contractError } from "@/lib/api-response";
import { abandonIdempotency, beginIdempotency, completeIdempotency, idempotencyErrorResponse, replayIdempotentResponse } from "@/lib/idempotency";
import { selectIncentive, toIncentiveDisplay } from "@/lib/incentives/selector";
import type { IncentiveDisplay, IncentiveDomain, IncentiveTrigger } from "@/lib/incentives/types";
import { logAgent, type AgentLogInput } from "@/lib/agent-log";
import { getRequestId } from "@/lib/request-id";
import { activeLiveEvents } from "@/lib/active-live-events";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

async function sendReplanResponse(
  request: Request,
  data: unknown,
  meta: Record<string, unknown>,
  idempotencyRecordId: string | null,
) {
  if (idempotencyRecordId) await completeIdempotency(idempotencyRecordId, 200, { data, meta });
  return jsonData(request, data, meta);
}

function dateForPlanMinute(base: Date, startMinute: number, minute: number) {
  return new Date(base.getTime() + (minute - startMinute) * 60_000);
}

function diffItinerary(before: Itinerary, after: Itinerary) {
  const oldById = new Map(before.stops.map((stop) => [stop.act_id, stop]));
  const newById = new Map(after.stops.map((stop) => [stop.act_id, stop]));
  const removed = before.stops.filter((stop) => !newById.has(stop.act_id)).map((stop) => ({ id: stop.act_id, name: stop.name, zone: stop.zone }));
  const added = after.stops.filter((stop) => !oldById.has(stop.act_id)).map((stop) => ({ id: stop.act_id, name: stop.name, zone: stop.zone, start: stop.start, end: stop.end }));
  const moved = after.stops.flatMap((stop) => {
    const old = oldById.get(stop.act_id);
    if (!old || (old.start === stop.start && old.end === stop.end && old.zone === stop.zone && old.note === stop.note)) return [];
    return [{ id: stop.act_id, name: stop.name, from: { start: old.start, end: old.end, zone: old.zone }, to: { start: stop.start, end: stop.end, zone: stop.zone, note: stop.note } }];
  });
  return { removed, added, moved, changed: Boolean(removed.length || added.length || moved.length) };
}

function proposalReason(updateIds: string[], snapshotSignature: string) {
  const signature = [...updateIds].sort().join(",") || "none";
  return `live_update_proposal:${signature}:snapshot:${snapshotSignature || "none"}`;
}

function storedPlan(row: StoredItinerary, catalogResult: Awaited<ReturnType<typeof loadSessionCatalog>>, profile: ReturnType<typeof resolveVisitWindow>["profile"]) {
  if (!catalogResult) throw new Error("catalog unavailable");
  return toEngineItinerary(row, catalogResult.catalog, profile);
}

function incentiveDomainFromRow(
  row: {
    id: string;
    kind: IncentiveDomain["kind"];
    titleAr: string;
    valueLabelAr: string;
    reasonAr: string;
    valueCents: number;
    priority: number;
    trigger: IncentiveDomain["trigger"];
    scopeTarget: IncentiveDomain["scopeTarget"];
    scopeKey: string | null;
    minCrowdLevel: number | null;
    redirectZoneKey: string | null;
    endsAt: Date | null;
    locationLabelAr: string | null;
    perVisitorCap: number;
  },
  claimsCount: number,
): IncentiveDomain {
  return {
    id: row.id,
    kind: row.kind,
    titleAr: row.titleAr,
    valueLabelAr: row.valueLabelAr,
    reasonAr: row.reasonAr,
    valueCents: row.valueCents,
    priority: row.priority,
    trigger: row.trigger,
    scopeTarget: row.scopeTarget,
    scopeKey: row.scopeKey,
    minCrowdLevel: row.minCrowdLevel,
    redirectZoneKey: row.redirectZoneKey,
    endsAt: row.endsAt,
    locationLabelAr: row.locationLabelAr,
    perVisitorCap: row.perVisitorCap,
    claimsCount,
  };
}

/** Normalize an engine event type to the EventUpdateType-aligned trigger (crowd_spike → CROWD_OVERRIDE). */
function normalizeTrigger(type: CrowdEvent["type"]): IncentiveTrigger | null {
  if (type === "cancel") return "CLOSURE";
  if (type === "delay") return "DELAY";
  if (type === "crowd_spike") return "CROWD_OVERRIDE";
  return null;
}

/**
 * Deterministically pick one incentive to surface in this replan. Pure selection is in
 * `@/lib/incentives/selector`; this only loads rows, derives the trigger/zone context and maps it.
 */
async function selectLiveIncentive(
  session: { id: string; eventId: string },
  live: { events: CrowdEvent[] },
  itinerary: Itinerary,
): Promise<IncentiveDisplay | null> {
  const triggers = new Set<IncentiveTrigger>();
  const crowdByZone = new Map<string, number>();
  for (const event of live.events) {
    const trigger = normalizeTrigger(event.type);
    if (trigger) triggers.add(trigger);
    if (event.type === "crowd_spike") {
      const level = typeof event.level === "number" ? event.level : 0.9;
      crowdByZone.set(event.zone, Math.max(crowdByZone.get(event.zone) ?? 0, level));
    }
  }
  let zoneStableKey: string | null = null;
  let crowdLevel = 0;
  for (const [zone, level] of crowdByZone) {
    if (level > crowdLevel) {
      crowdLevel = level;
      zoneStableKey = zone;
    }
  }

  const now = new Date();
  const rows = await prisma.incentive.findMany({
    where: {
      eventId: session.eventId,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ],
    },
    include: { _count: { select: { claims: true } } },
  });
  const claimed = new Set(
    (
      await prisma.visitorIncentiveClaim.findMany({
        where: { sessionId: session.id },
        select: { incentiveId: true },
      })
    ).map((claim) => claim.incentiveId),
  );

  const selected = selectIncentive(
    rows.filter((row) =>
      (!row.redirectZoneKey || itinerary.stops.some((stop) => stop.zone === row.redirectZoneKey))
      && (row.scopeTarget !== "ZONE" || itinerary.stops.some((stop) => stop.zone === row.scopeKey))
      && (row.scopeTarget !== "ACTIVITY" || itinerary.stops.some((stop) => stop.act_id === row.scopeKey)),
    ).map((row) => incentiveDomainFromRow(row, 0)),
    { triggers, zoneStableKey, crowdLevel, waitMinutes: 0, alreadyClaimedIds: claimed },
  );
  return selected ? toIncentiveDisplay(selected) : null;
}

type ProposalRejection = "PROPOSAL_REQUIRED" | "PROPOSAL_NOT_FOUND" | "PROPOSAL_STALE";
const PROPOSAL_REASON: Record<ProposalRejection, AgentLogInput["reason_code"]> = {
  PROPOSAL_REQUIRED: "missing_proposal",
  PROPOSAL_NOT_FOUND: "proposal_not_found",
  PROPOSAL_STALE: "stale_revision",
};

/** Item 6: every refused accept/keep_current leaves one content-free record (item 5 schema). */
function logProposalRejection(request: Request, startedAt: number, step: string, code: ProposalRejection) {
  logAgent({
    trace_id: getRequestId(request),
    channel: "text",
    path: "rule_based",
    step,
    latency_ms: Math.max(0, Math.round(performance.now() - startedAt)),
    status: code === "PROPOSAL_STALE" ? "conflict" : "rejected",
    reason_code: PROPOSAL_REASON[code],
  });
}

export async function POST(request: Request, context: Context) {
  const startedAt = performance.now();
  const { eventSlug } = await context.params;
  if (!getVisitorToken(request)) return contractError(request, "SESSION_TOKEN_REQUIRED", "يلزم رمز جلسة الزيارة.", 401);
  const session = await resolveVisitorSession(eventSlug, request);
  if (!session) return contractError(request, "SESSION_NOT_FOUND", "جلسة الزيارة غير موجودة أو انتهت.", 404);
  const rate = await enforceRateLimit(request, { scope: `replan:${eventSlug}:${session.id}`, limit: 12 });
  if (!rate.allowed) {
    const response = contractError(request, "RATE_LIMITED", "تم تجاوز عدد طلبات إعادة التخطيط. حاول بعد قليل.", 429);
    response.headers.set("retry-after", String(rate.retryAfterSeconds));
    return response;
  }
  const parsed = replanRequestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    const missingProposalField = ["proposalId", "baseItineraryId", "baseLiveRevision"].some((field) => field in flat.fieldErrors);
    if (missingProposalField) logProposalRejection(request, startedAt, "proposal.validate", "PROPOSAL_REQUIRED");
    return contractError(request, "INVALID_REQUEST", "بيانات إعادة التخطيط غير صالحة.", 400, flat);
  }

  const catalogResult = await loadSessionCatalog(eventSlug, session.catalogVersionId);
  if (!catalogResult || catalogResult.catalogVersionId !== session.catalogVersionId) return contractError(request, "CATALOG_VERSION_UNAVAILABLE", "نسخة الكتالوج المرتبطة بالجلسة غير متاحة.", 409);
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
  const nowMinute = process.env.WANEES_ALLOW_CLOCK_OVERRIDE === "true" && parsed.data.nowMinute != null ? parsed.data.nowMinute : visitNowMinute(visit, clock.nowMinute);
  const baseWhere = { sessionId: session.id, eventId: session.eventId, catalogVersionId: session.catalogVersionId };
  const latest = await prisma.itinerary.findFirst({
    where: { ...baseWhere, status: "active" },
    orderBy: { generatedAt: "desc" },
    include: { items: { orderBy: { sequence: "asc" }, include: { activity: { include: { zone: true } } } } },
  });
  if (!latest) return contractError(request, "ITINERARY_NOT_FOUND", "لا يوجد مسار محفوظ لإعادة تخطيطه.", 404);

  const idempotency = await beginIdempotency(request, {
    sessionId: session.id,
    scope: "itinerary.replan",
    payload: parsed.data,
  });
  if (idempotency.kind === "replay") return replayIdempotentResponse(request, idempotency.body, idempotency.statusCode);
  const idempotencyFailure = idempotencyErrorResponse(request, idempotency);
  if (idempotencyFailure) return idempotencyFailure;
  const idempotencyRecordId = idempotency.kind === "proceed" ? idempotency.recordId : null;

  const fail = async (code: string, message: string, status: number) => {
    if (idempotencyRecordId) await abandonIdempotency(idempotencyRecordId);
    if (code === "PROPOSAL_REQUIRED" || code === "PROPOSAL_NOT_FOUND" || code === "PROPOSAL_STALE") {
      logProposalRejection(request, startedAt, `proposal.${parsed.data.decision}`, code);
    }
    return contractError(request, code, message, status);
  };

  const before = storedPlan(latest as unknown as StoredItinerary, catalogResult, profile);
  const live = await activeLiveEvents(session.eventId, session.catalogVersionId, new Date(), nowMinute);

  if (parsed.data.decision === "keep_current" || parsed.data.decision === "accept") {
    if (!parsed.data.proposalId) return fail("PROPOSAL_REQUIRED", "يلزم تحديد اقتراح إعادة التخطيط.", 400);
    const proposal = await prisma.itinerary.findFirst({
      where: { id: parsed.data.proposalId, ...baseWhere, status: "proposed", OR: [{ proposalExpiresAt: null }, { proposalExpiresAt: { gt: new Date() } }] },
      include: { items: { orderBy: { sequence: "asc" }, include: { activity: { include: { zone: true } } } } },
    });
    if (!proposal) {
      // Item 6: a proposal this session already decided (or that expired) is a conflict, not unknown.
      // Another session's id still gets 404, so ids can't be probed across sessions.
      const decided = await prisma.itinerary.findFirst({ where: { id: parsed.data.proposalId, ...baseWhere }, select: { id: true } });
      if (decided) return fail("PROPOSAL_STALE", "هذا الاقتراح لم يعد متاحًا. اطلب اقتراحًا جديدًا.", 409);
      return fail("PROPOSAL_NOT_FOUND", "اقتراح إعادة التخطيط غير موجود أو انتهت صلاحيته.", 404);
    }
    const assistantProposal = proposal.generatedReason?.startsWith("assistant_") === true;
    if (
      // Item 6: always enforced. WANEES_FEATURE_PROPOSAL_CONCURRENCY no longer gates accept.
      parsed.data.decision === "accept" &&
      (proposal.baseItineraryId !== latest.id || parsed.data.baseItineraryId !== latest.id ||
        proposal.baseLiveRevision !== live.liveRevision || parsed.data.baseLiveRevision !== live.liveRevision)
    ) {
      return fail("PROPOSAL_STALE", "تغيرت الحالة الحية منذ إنشاء الاقتراح. اطلب اقتراحًا جديدًا.", 409);
    }
    const candidate = storedPlan(proposal as unknown as StoredItinerary, catalogResult, profile);
    const diff = diffItinerary(before, candidate);
    if (parsed.data.decision === "keep_current") {
      const dismissed = await prisma.itinerary.updateMany({
        where: { id: proposal.id, ...baseWhere, status: "proposed" },
        data: { status: "dismissed", decisionAt: new Date() },
      });
      if (!dismissed.count) return fail("PROPOSAL_STALE", "هذا الاقتراح لم يعد متاحًا.", 409);
      await prisma.visitorSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
      return sendReplanResponse(request, { mode: "DISMISSED", itineraryId: latest.id, proposalId: proposal.id, itinerary: before, candidateItinerary: null, diff, nowMinute, clock }, { persistence: "postgresql", catalogVersionId: session.catalogVersionId }, idempotencyRecordId);
    }

    const stale = new Error("proposal became stale during acceptance");
    try {
      await prisma.$transaction(async (tx) => {
        const base = await tx.itinerary.updateMany({
          where: { ...baseWhere, id: latest.id, status: "active" },
          data: { status: "superseded" },
        });
        if (!base.count) throw stale;
        const decidedAt = new Date();
        const liveAtDecision = await activeLiveEvents(session.eventId, session.catalogVersionId, decidedAt, nowMinute, tx);
        if (liveAtDecision.liveRevision !== proposal.baseLiveRevision) throw stale;
        const accepted = await tx.itinerary.updateMany({
          where: { ...baseWhere, id: proposal.id, status: "proposed", OR: [{ proposalExpiresAt: null }, { proposalExpiresAt: { gt: decidedAt } }] },
          data: { status: "active", generatedReason: assistantProposal ? "assistant_accepted" : "live_update_accepted", decisionAt: decidedAt, proposalExpiresAt: null },
        });
        if (!accepted.count) throw stale;
        await tx.visitorSession.update({ where: { id: session.id }, data: { lastSeenAt: decidedAt } });
      });
    } catch (error) {
      if (error !== stale) throw error;
      return fail("PROPOSAL_STALE", "تغير المسار أو حالة الموقع أثناء قبول الاقتراح. اطلب اقتراحًا جديدًا.", 409);
    }
    return sendReplanResponse(request, { mode: "APPLIED", itineraryId: proposal.id, proposalId: proposal.id, itinerary: candidate, candidateItinerary: candidate, diff, nowMinute, clock, live: { liveRevision: live.liveRevision, eventUpdateIds: live.updateIds, snapshotCount: live.snapshotCount } }, { persistence: "postgresql", catalogVersionId: session.catalogVersionId }, idempotencyRecordId);
  }

  const cancelled = live.events.filter((event) => event.type === "cancel");
  const urgent = cancelled.some((event) =>
    before.stops.some((stop) => stop.act_id === event.activity && stop.end > nowMinute),
  );
  const relevant = hasStaleDelay(before, nowMinute, live.events) || live.events.some((event) => before.stops.some((stop) => {
    if (stop.end <= nowMinute) return false;
    if (event.type === "delay" || event.type === "cancel") return event.activity === stop.act_id;
    return event.type === "crowd_spike" && event.zone === stop.zone;
  }));
  const reason = proposalReason(live.updateIds, live.snapshotSignature);
  const decided = !urgent && (
    (latest.generatedReason === "live_update_accepted" && latest.baseLiveRevision === live.liveRevision) ||
    Boolean(await prisma.itinerary.findFirst({
      where: { ...baseWhere, status: "dismissed", generatedReason: reason, baseItineraryId: latest.id, baseLiveRevision: live.liveRevision },
      select: { id: true },
    }))
  );
  const after = relevant && !decided
    ? replan(new Site(catalogResult.catalog), profile, before, nowMinute, urgent ? cancelled : live.events)
    : before;
  const diff = diffItinerary(before, after);
  const incentive = diff.changed ? await selectLiveIncentive(session, live, after) : null;
  if (!diff.changed) {
    await prisma.visitorSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    return sendReplanResponse(request, { mode: "NO_CHANGE", itineraryId: latest.id, itinerary: before, candidateItinerary: null, diff, incentive, nowMinute, clock, live: { liveRevision: live.liveRevision, eventUpdateIds: live.updateIds, snapshotCount: live.snapshotCount } }, { persistence: "postgresql", catalogVersionId: session.catalogVersionId, changed: false }, idempotencyRecordId);
  }

  const stableKeys = after.stops.map((stop) => stop.act_id);
  const activityRows = await prisma.activity.findMany({ where: { catalogVersionId: session.catalogVersionId, stableKey: { in: stableKeys } }, select: { id: true, stableKey: true } });
  const activityIds = new Map(activityRows.map((activity) => [activity.stableKey, activity.id]));
  if (activityRows.length !== stableKeys.length) return fail("CATALOG_INCOMPLETE", "بعض محطات إعادة التخطيط غير موجودة في الكتالوج المنشور.", 409);

  const existingProposal = urgent ? null : await prisma.itinerary.findFirst({
    where: { ...baseWhere, status: "proposed", generatedReason: reason, baseItineraryId: latest.id, baseLiveRevision: live.liveRevision, OR: [{ proposalExpiresAt: null }, { proposalExpiresAt: { gt: new Date() } }] },
    orderBy: { generatedAt: "desc" },
    include: { items: { orderBy: { sequence: "asc" }, include: { activity: { include: { zone: true } } } } },
  });
  if (existingProposal) {
    const candidate = storedPlan(existingProposal as unknown as StoredItinerary, catalogResult, profile);
    // A stored proposal carries no explanations; the current deterministic run is the same proposal, so reuse its explanation.
    if (!candidate.explanations.length) candidate.explanations = after.explanations;
    return sendReplanResponse(request, { mode: "PROPOSED", itineraryId: latest.id, proposalId: existingProposal.id, itinerary: before, candidateItinerary: candidate, diff: diffItinerary(before, candidate), incentive, nowMinute, clock, proposal: { baseItineraryId: existingProposal.baseItineraryId, baseLiveRevision: existingProposal.baseLiveRevision, proposalExpiresAt: existingProposal.proposalExpiresAt?.toISOString() ?? null }, live: { liveRevision: live.liveRevision, eventUpdateIds: live.updateIds, snapshotCount: live.snapshotCount } }, { persistence: "postgresql", catalogVersionId: session.catalogVersionId, changed: true }, idempotencyRecordId);
  }

  const base = new Date();
  const stored = await prisma.$transaction(async (tx) => {
    const nextItinerary = await tx.itinerary.create({
      data: {
        sessionId: session.id,
        eventId: session.eventId,
        catalogVersionId: session.catalogVersionId,
        status: urgent ? "active" : "proposed",
        generatedReason: urgent ? "live_update_urgent" : reason,
        baseItineraryId: urgent ? null : latest.id,
        baseLiveRevision: urgent ? null : live.liveRevision,
        proposalExpiresAt: urgent ? null : new Date(Date.now() + 15 * 60_000),
        totalCostCents: Math.round(after.total_cost * 100),
        totalWalkMin: after.stops.reduce((sum, stop) => sum + stop.walk_min, 0),
        totalWaitMin: after.stops.reduce((sum, stop) => sum + stop.wait_min, 0),
        items: {
          create: after.stops.map((stop, index) => ({
            activityId: activityIds.get(stop.act_id)!,
            sequence: index,
            startsAt: dateForPlanMinute(base, profile.start_min, stop.start),
            endsAt: dateForPlanMinute(base, profile.start_min, stop.end),
            walkMin: stop.walk_min,
            waitMin: stop.wait_min,
            score: after.score,
            reasonCodes: stop.note ? [stop.note] : [],
            sourceRefs: [`catalog:${session.catalogVersionId}`, ...live.updateIds.map((id) => `event-update:${id}`), `live-snapshots:${live.snapshotCount}`],
          })),
        },
      },
      include: { items: { orderBy: { sequence: "asc" }, include: { activity: { include: { zone: true } } } } },
    });
    if (urgent) {
      await tx.itinerary.updateMany({ where: { ...baseWhere, status: "proposed" }, data: { status: "dismissed", decisionAt: new Date() } });
      await tx.itinerary.updateMany({ where: { ...baseWhere, status: "active", id: { not: nextItinerary.id } }, data: { status: "superseded" } });
    }
    await tx.visitorSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    return nextItinerary;
  });
  const candidate = storedPlan(stored as unknown as StoredItinerary, catalogResult, profile);
  const mode = urgent ? "APPLIED" : "PROPOSED";
  return sendReplanResponse(request, { mode, itineraryId: urgent ? stored.id : latest.id, proposalId: urgent ? null : stored.id, itinerary: urgent ? candidate : before, candidateItinerary: candidate, diff, incentive, nowMinute, clock, proposal: urgent ? null : { baseItineraryId: stored.baseItineraryId, baseLiveRevision: stored.baseLiveRevision, proposalExpiresAt: stored.proposalExpiresAt?.toISOString() ?? null }, live: { liveRevision: live.liveRevision, eventUpdateIds: live.updateIds, snapshotCount: live.snapshotCount } }, { persistence: "postgresql", catalogVersionId: session.catalogVersionId, changed: true }, idempotencyRecordId);
}
