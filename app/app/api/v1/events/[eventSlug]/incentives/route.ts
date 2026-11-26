import { z } from "zod";
import { activeLiveEvents } from "@/lib/active-live-events";
import { enforceRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import { getVisitorToken, resolveVisitorSession } from "@/lib/visitor-auth";
import { jsonData, jsonError } from "@/lib/api-response";
import { toIncentiveDisplay } from "@/lib/incentives/selector";
import type { IncentiveDomain } from "@/lib/incentives/types";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

type IncentiveRow = {
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
  _count: { claims: number };
};

function toDomain(row: IncentiveRow): IncentiveDomain {
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
    claimsCount: row._count.claims,
  };
}

const claimRequest = z.object({ incentiveId: z.string().trim().min(1).max(100) }).strict();

async function availableOffers(session: NonNullable<Awaited<ReturnType<typeof resolveVisitorSession>>>) {
  const now = new Date();
  const rows = await prisma.incentive.findMany({
    where: {
      eventId: session.eventId,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      ],
    },
    orderBy: [{ priority: "desc" }, { id: "asc" }],
    include: { _count: { select: { claims: true } } },
  });
  const claims = await prisma.visitorIncentiveClaim.findMany({
    where: { sessionId: session.id, incentive: { eventId: session.eventId } },
    select: { incentiveId: true },
  });
  const claimed = new Set(claims.map((claim) => claim.incentiveId));
  if (!rows.some((item) => item.trigger || item.scopeTarget || item.redirectZoneKey || item.minCrowdLevel != null)) {
    return rows.map((row) => ({ incentive: toIncentiveDisplay(toDomain(row)), claimed: claimed.has(row.id) }));
  }
  const itinerary = await prisma.itinerary.findFirst({
    where: { sessionId: session.id, eventId: session.eventId, status: "active" },
    orderBy: { generatedAt: "desc" },
    include: { items: { include: { activity: { include: { zone: true } } } } },
  });
  const activities = new Set(itinerary?.items.map(({ activity }) => activity.stableKey));
  const zones = new Set(itinerary?.items.map(({ activity }) => activity.zone.stableKey));
  const live = await activeLiveEvents(session.eventId, session.catalogVersionId, now, session.preferences?.startMinute ?? 1080);
  const filtered = rows.filter((row) => {
    if (claimed.has(row.id)) return true;
    if (row.redirectZoneKey && !zones.has(row.redirectZoneKey)) return false;
    if (row.scopeTarget === "ZONE" && (!row.scopeKey || !zones.has(row.scopeKey))) return false;
    if (row.scopeTarget === "ACTIVITY" && (!row.scopeKey || !activities.has(row.scopeKey))) return false;
    if (row.trigger === "CROWD_OVERRIDE" || row.minCrowdLevel != null) {
      return live.events.some((event) => event.type === "crowd_spike" && event.measured
        && event.level != null && event.level >= (row.minCrowdLevel ?? 0.75)
        && (row.scopeTarget !== "ZONE" || event.zone === row.scopeKey));
    }
    if (row.trigger === "CLOSURE" || row.trigger === "SCHEDULE_CHANGE") {
      return live.events.some((event) => event.type === "cancel" && (row.scopeTarget !== "ACTIVITY" || event.activity === row.scopeKey));
    }
    if (row.trigger === "DELAY") {
      return live.events.some((event) => event.type === "delay" && (row.scopeTarget !== "ACTIVITY" || event.activity === row.scopeKey));
    }
    return true;
  });
  return filtered.map((row) => ({ incentive: toIncentiveDisplay(toDomain(row)), claimed: claimed.has(row.id) }));
}

export async function GET(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  if (!getVisitorToken(request)) return jsonError(request, "SESSION_TOKEN_REQUIRED", "يلزم رمز جلسة الزيارة.", 401);
  const session = await resolveVisitorSession(eventSlug, request);
  if (!session) return jsonError(request, "SESSION_NOT_FOUND", "جلسة الزيارة غير موجودة أو انتهت.", 404);
  const offers = await availableOffers(session);
  return jsonData(request, offers, { persistence: "postgresql", count: offers.length });
}

export async function POST(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  if (!getVisitorToken(request)) return jsonError(request, "SESSION_TOKEN_REQUIRED", "يلزم رمز جلسة الزيارة.", 401);
  const session = await resolveVisitorSession(eventSlug, request);
  if (!session) return jsonError(request, "SESSION_NOT_FOUND", "جلسة الزيارة غير موجودة أو انتهت.", 404);
  const parsed = claimRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(request, "INVALID_REQUEST", "اختر حافزًا صالحًا.", 400);
  const rate = await enforceRateLimit(request, { scope: `offer:${eventSlug}:${session.id}`, limit: 20 });
  if (!rate.allowed) return jsonError(request, "RATE_LIMITED", "حاول بعد قليل.", 429);
  const { incentiveId } = parsed.data;
  const offer = (await availableOffers(session)).find((row) => row.incentive.incentiveId === incentiveId);
  if (!offer) return jsonError(request, "CONFLICT", "الحافز غير متاح الآن.", 409);
  await prisma.visitorIncentiveClaim.createMany({
    data: { sessionId: session.id, incentiveId }, skipDuplicates: true,
  });
  return jsonData(request, { incentive: offer.incentive, claimed: true }, { persistence: "postgresql" });
}
