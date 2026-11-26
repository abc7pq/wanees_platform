import { PITCH_EVENT_SLUG, PITCH_ORGANIZATION_SLUG } from "../../../../../../../packages/contracts/src/index.ts";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { loadPublishedEventCatalog } from "@/lib/db-catalog";
import { getEventClock } from "@/lib/event-clock";
import { liveRevisionFor, loadCurrentCrowdSnapshots } from "@/lib/live-updates";
import { jsonData } from "@/lib/api-response";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(_request: Request, context: Context) {
  const { eventSlug } = await context.params;
  if (!process.env.DATABASE_URL) return errorResponse("DATABASE_UNAVAILABLE", "الحالة الحية تحتاج إلى قاعدة بيانات مفعلة.", 503);

  const now = new Date();
  const event = await prisma.event.findFirst({
    where: { slug: eventSlug, ...(eventSlug === PITCH_EVENT_SLUG ? { organization: { slug: PITCH_ORGANIZATION_SLUG } } : {}), status: { in: ["PUBLISHED", "LIVE"] as any } },
    select: { id: true, slug: true, name: true, startsAt: true, endsAt: true, venue: { select: { timezone: true } }, publishedCatalogVersionId: true },
  });
  if (!event || !event.publishedCatalogVersionId) return errorResponse("EVENT_NOT_FOUND", "الفعالية غير موجودة أو لا تملك كتالوجًا منشورًا.", 404);
  const catalog = await loadPublishedEventCatalog(eventSlug);
  const clock = getEventClock({
    eventSlug,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    timezone: event.venue?.timezone,
    openingFrom: catalog?.catalog.site.opening.from ?? 1020,
    openingTo: catalog?.catalog.site.opening.to ?? 1440,
  });

  const [latestSnapshots, updates] = await Promise.all([
    loadCurrentCrowdSnapshots(prisma, event.id, event.publishedCatalogVersionId, now),
    prisma.eventUpdate.findMany({
      where: {
        eventId: event.id,
        revokedAt: null,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
    }),
  ]);

  const crowd = latestSnapshots.map((snapshot) => ({
    zone: snapshot.zone.stableKey,
    zoneName: snapshot.zone.nameAr,
    level: snapshot.level,
    source: snapshot.source.toLowerCase(),
    confidence: snapshot.confidence,
    observation: snapshot.eventUpdate?.payload ?? null,
    observedAt: snapshot.observedAt.toISOString(),
    expiresAt: snapshot.expiresAt?.toISOString() ?? null,
  }));
  const activeUpdates = updates.map((update) => ({
    id: update.id,
    updateType: update.updateType,
    source: "operator",
    targetType: update.targetType,
    targetId: update.targetId,
    payload: update.payload,
    startsAt: update.startsAt?.toISOString() ?? null,
    endsAt: update.endsAt?.toISOString() ?? null,
    createdAt: update.createdAt.toISOString(),
  }));
  const revision = liveRevisionFor(updates, latestSnapshots);

  return jsonData(_request, {
      event: { id: event.id, slug: event.slug, name: event.name },
      catalogVersionId: event.publishedCatalogVersionId,
      capturedAt: now.toISOString(),
      clock,
      revision,
      nextPollAfterMs: 10_000,
      staleAfterMs: 45_000,
      crowd,
      updates: activeUpdates,
    }, {
      persistence: "postgresql",
      simulated: crowd.some((row) => row.source === "simulated"),
      sources: [...new Set(crowd.map((row) => row.source))],
      contractVersion: "v1",
  });
}
