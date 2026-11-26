import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeEventRequest } from "@/lib/catalog-auth";
import { withAdminApiContract } from "@/lib/api-response";
import { addTo, buildHourBreakdown, buildPartyBreakdown, buildZoneBreakdown, localHour, resolveTimeZone, SMALL_COUNT_THRESHOLD } from "@/lib/analytics-breakdowns";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export const GET = withAdminApiContract(async function GET(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  const access = await authorizeEventRequest(request, eventSlug, ["OWNER", "ADMIN", "OPERATOR", "EDITOR", "ANALYST", "VIEWER"]);
  if (!access.authorized) return errorResponse(access.userId ? "FORBIDDEN" : "UNAUTHORIZED", access.userId ? "لا تملك صلاحية هذه الفعالية." : "غير مصرح.", access.userId ? 403 : 401);
  if (!access.event) return errorResponse("EVENT_NOT_FOUND", "الفعالية غير موجودة.", 404);

  const url = new URL(request.url);
  const sinceRaw = url.searchParams.get("since");
  const sinceCandidate = sinceRaw ? new Date(sinceRaw) : new Date(Date.now() - 24 * 60 * 60_000);
  const since = Number.isNaN(sinceCandidate.getTime()) ? new Date(Date.now() - 24 * 60 * 60_000) : sinceCandidate;
  const [analytics, assistantEvents, sessionCount, itineraryCount, updateCount, openHandoffCount, version] = await Promise.all([
    prisma.analyticsEvent.findMany({ where: { eventId: access.event.id, bucketStart: { gte: since } }, orderBy: { bucketStart: "asc" }, take: 20_000 }),
    prisma.assistantEvent.findMany({ where: { eventId: access.event.id, createdAt: { gte: since } }, select: { intent: true, resultType: true, sourceCount: true, latencyMs: true, createdAt: true }, orderBy: { createdAt: "asc" }, take: 20_000 }),
    prisma.visitorSession.count({ where: { eventId: access.event.id, startedAt: { gte: since }, deletedAt: null } }),
    prisma.itinerary.count({ where: { eventId: access.event.id, generatedAt: { gte: since } } }),
    prisma.eventUpdate.count({ where: { eventId: access.event.id, createdAt: { gte: since } } }),
    prisma.visitorHandoff.count({ where: { eventId: access.event.id, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    access.event.publishedCatalogVersionId ? prisma.catalogVersion.findUnique({ where: { id: access.event.publishedCatalogVersionId }, include: { zones: true, activities: true } }) : null,
  ]);

  // Registered visitors in this window, and how many of them had visited this organizer before. Counts only.
  const windowVisits = await prisma.visitorVisit.findMany({ where: { eventId: access.event.id, startedAt: { gte: since } }, select: { visitorId: true } });
  const windowVisitorIds = [...new Set(windowVisits.map((visit) => visit.visitorId))];
  const earlier = windowVisitorIds.length
    ? await prisma.visitorVisit.findMany({
      where: { visitorId: { in: windowVisitorIds }, startedAt: { lt: since }, visitor: { organizationId: access.event.organizationId } },
      select: { visitorId: true },
      distinct: ["visitorId"],
    })
    : [];

  const metricMap = new Map<string, { count: number; value: number; lastBucket: string }>();
  const zoneMap = new Map<string, { count: number; value: number }>();
  const activityMap = new Map<string, { count: number; value: number }>();
  for (const row of analytics) {
    const metric = metricMap.get(row.metricName) ?? { count: 0, value: 0, lastBucket: row.bucketStart.toISOString() };
    metric.count += 1;
    metric.value += row.metricValue;
    metric.lastBucket = row.bucketStart.toISOString();
    metricMap.set(row.metricName, metric);
    if (row.zoneId) {
      const zone = zoneMap.get(row.zoneId) ?? { count: 0, value: 0 };
      zone.count += 1;
      zone.value += row.metricValue;
      zoneMap.set(row.zoneId, zone);
    }
    if (row.activityId) {
      const activity = activityMap.get(row.activityId) ?? { count: 0, value: 0 };
      activity.count += 1;
      activity.value += row.metricValue;
      activityMap.set(row.activityId, activity);
    }
  }
  const assistantByIntent = new Map<string, { count: number; avgLatencyMs: number; sourceCount: number }>();
  for (const row of assistantEvents) {
    const item = assistantByIntent.get(row.intent) ?? { count: 0, avgLatencyMs: 0, sourceCount: 0 };
    item.count += 1;
    item.avgLatencyMs += row.latencyMs ?? 0;
    item.sourceCount += row.sourceCount;
    assistantByIntent.set(row.intent, item);
  }
  const zoneNames = new Map((version?.zones ?? []).map((zone) => [zone.id, { id: zone.stableKey, name: zone.nameAr }]));
  const activityNames = new Map((version?.activities ?? []).map((activity) => [activity.id, { id: activity.stableKey, name: activity.nameAr }]));

  const breakdowns = await buildBreakdowns({
    eventId: access.event.id,
    since,
    publishedZones: (version?.zones ?? []).map((zone) => ({ id: zone.stableKey, name: zone.nameAr })),
    analytics,
    assistantEvents,
  });

  return NextResponse.json({
    data: {
      window: { since: since.toISOString(), until: new Date().toISOString() },
      totals: { sessions: sessionCount, itineraries: itineraryCount, updates: updateCount, analyticsEvents: analytics.length, assistantEvents: assistantEvents.length, openHandoffs: openHandoffCount, registeredVisitors: windowVisitorIds.length, returningVisitors: earlier.length },
      metrics: [...metricMap.entries()].map(([metricName, row]) => ({ metricName, ...row })),
      byZone: [...zoneMap.entries()].map(([id, row]) => ({ ...zoneNames.get(id), ...row })),
      byActivity: [...activityMap.entries()].map(([id, row]) => ({ ...activityNames.get(id), ...row })),
      assistant: [...assistantByIntent.entries()].map(([intent, row]) => ({ intent, count: row.count, avgLatencyMs: row.count ? Math.round(row.avgLatencyMs / row.count) : 0, sourceCount: row.sourceCount })),
      breakdowns,
    },
    meta: { persistence: "postgresql", privacy: "aggregated_no_raw_visitor_text", smallCountThreshold: SMALL_COUNT_THRESHOLD },
  });
});

type BreakdownInput = {
  eventId: string;
  since: Date;
  publishedZones: { id: string; name: string }[];
  analytics: { zoneId: string | null; bucketStart: Date }[];
  assistantEvents: { createdAt: Date }[];
};

/**
 * Flow by zone, by local hour and by party type. Every query selects only timestamps, zone ids
 * or the coarse party answers; no session id leaves this function, and visitor counts under
 * SMALL_COUNT_THRESHOLD are reported as "<5" (admin/lib/analytics-breakdowns.ts).
 */
async function buildBreakdowns({ eventId, since, publishedZones, analytics, assistantEvents }: BreakdownInput) {
  const now = new Date();
  const [event, sessions, itineraries, preferences, stopsByActivity, presence, crowd] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId }, select: { venue: { select: { timezone: true } } } }),
    prisma.visitorSession.findMany({ where: { eventId, startedAt: { gte: since }, deletedAt: null }, select: { startedAt: true }, take: 50_000 }),
    prisma.itinerary.findMany({ where: { eventId, generatedAt: { gte: since } }, select: { generatedAt: true }, take: 50_000 }),
    prisma.visitorPreference.findMany({
      where: { session: { eventId, startedAt: { gte: since }, deletedAt: null } },
      select: { companions: true, partySize: true, youngestChildAge: true },
      take: 50_000,
    }),
    // Stops in the plans visitors currently hold (replaced and dismissed proposals are not counted twice).
    prisma.itineraryItem.groupBy({
      by: ["activityId"],
      where: { itinerary: { eventId, generatedAt: { gte: since }, status: { in: ["active", "completed"] } } },
      _count: { _all: true },
    }),
    prisma.presencePing.groupBy({ by: ["zoneId"], where: { eventId, expiresAt: { gt: now } }, _count: { _all: true } }),
    prisma.crowdSnapshot.groupBy({ by: ["zoneId"], where: { eventId, observedAt: { gte: since } }, _avg: { level: true } }),
  ]);

  const activities = stopsByActivity.length
    ? await prisma.activity.findMany({
      where: { id: { in: stopsByActivity.map((row) => row.activityId) }, catalogVersion: { eventId } },
      select: { id: true, zoneId: true },
    })
    : [];
  const zoneIds = new Set<string>([
    ...activities.map((activity) => activity.zoneId),
    ...presence.map((row) => row.zoneId),
    ...crowd.map((row) => row.zoneId),
    ...analytics.flatMap((row) => (row.zoneId ? [row.zoneId] : [])),
  ]);
  // Zone rows differ per catalog version; the stable key joins them across versions.
  const zoneRows = zoneIds.size
    ? await prisma.zone.findMany({ where: { id: { in: [...zoneIds] }, catalogVersion: { eventId } }, select: { id: true, stableKey: true, nameAr: true } })
    : [];
  const zoneKey = new Map(zoneRows.map((zone) => [zone.id, zone.stableKey]));
  const zoneNames = new Map(zoneRows.map((zone) => [zone.stableKey, zone.nameAr]));
  const activityZone = new Map(activities.map((activity) => [activity.id, zoneKey.get(activity.zoneId)]));

  const plannedStops = new Map<string, number>();
  for (const row of stopsByActivity) {
    const key = activityZone.get(row.activityId);
    if (key) addTo(plannedStops, key, row._count._all);
  }
  const presentNow = new Map<string, number>();
  for (const row of presence) {
    const key = zoneKey.get(row.zoneId);
    if (key) addTo(presentNow, key, row._count._all);
  }
  const interactions = new Map<string, number>();
  for (const row of analytics) {
    const key = row.zoneId ? zoneKey.get(row.zoneId) : undefined;
    if (key) addTo(interactions, key);
  }
  // One zone across several catalog versions: plain mean of the per-version means.
  const crowdSums = new Map<string, number>();
  const crowdParts = new Map<string, number>();
  for (const row of crowd) {
    const key = zoneKey.get(row.zoneId);
    if (!key || typeof row._avg.level !== "number") continue;
    addTo(crowdSums, key, row._avg.level);
    addTo(crowdParts, key);
  }
  const crowdLevel = new Map([...crowdSums.entries()].map(([key, sum]) => [key, sum / (crowdParts.get(key) ?? 1)]));

  const timezone = resolveTimeZone(event?.venue?.timezone);
  return {
    timezone,
    smallCountThreshold: SMALL_COUNT_THRESHOLD,
    byZone: buildZoneBreakdown(publishedZones, { plannedStops, presentNow, interactions, crowdLevel }, zoneNames),
    byHour: buildHourBreakdown({
      sessions: sessions.map((row) => row.startedAt),
      itineraries: itineraries.map((row) => row.generatedAt),
      interactions: [...analytics.map((row) => row.bucketStart), ...assistantEvents.map((row) => row.createdAt)],
    }, timezone, localHour(since, timezone)),
    byPartyType: buildPartyBreakdown(preferences),
  };
}
