// خريطة الزحام الحالية لكل منطقة (طبقة «الزحام» في الخريطة، مثل حركة المرور في Google).
// الأولوية: قياس أجهزة الزوار/حساسات (sensor) ← بلاغ المشغل (operator) ← لقطة محاكاة ← تقدير النموذج (estimate).
// قراءات مجمعة فقط: لا معرفات أجهزة ولا جلسات.
import { PITCH_EVENT_SLUG, PITCH_ORGANIZATION_SLUG } from "../../../../../../../packages/contracts/src/index.ts";
import { prisma } from "@/lib/db";
import { loadPublishedEventCatalog } from "@/lib/db-catalog";
import { getEventClock } from "@/lib/event-clock";
import { isMeasuredCrowd, loadCurrentCrowdSnapshots } from "@/lib/live-updates";
import { jsonData, jsonError } from "@/lib/api-response";
import { Site } from "@/engine/site.ts";
import { zoneForecast } from "@/lib/crowd-forecast";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

export async function GET(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  if (!process.env.DATABASE_URL) return jsonError(request, "DATABASE_UNAVAILABLE", "خريطة الزحام تحتاج قاعدة بيانات مفعلة.", 503);
  const event = await prisma.event.findFirst({
    where: { slug: eventSlug, ...(eventSlug === PITCH_EVENT_SLUG ? { organization: { slug: PITCH_ORGANIZATION_SLUG } } : {}), status: { in: ["PUBLISHED", "LIVE"] as never } },
    select: { id: true, startsAt: true, endsAt: true, venue: { select: { timezone: true } }, publishedCatalogVersionId: true },
  });
  if (!event?.publishedCatalogVersionId) return jsonError(request, "EVENT_NOT_FOUND", "الفعالية غير موجودة أو لا تملك كتالوجًا منشورًا.", 404);
  const catalog = await loadPublishedEventCatalog(eventSlug);
  if (!catalog) return jsonError(request, "EVENT_NOT_FOUND", "الفعالية غير موجودة أو لا تملك كتالوجًا منشورًا.", 404);

  const now = new Date();
  const clock = getEventClock({
    eventSlug,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    timezone: event.venue?.timezone,
    openingFrom: catalog.catalog.site.opening.from ?? 1020,
    openingTo: catalog.catalog.site.opening.to ?? 1440,
  });
  const snapshots = await loadCurrentCrowdSnapshots(prisma, event.id, event.publishedCatalogVersionId, now);
  const byZone = new Map(snapshots.map((snapshot) => [snapshot.zone.stableKey, snapshot]));
  const site = new Site(catalog.catalog);

  const opening = { openingFrom: catalog.catalog.site.opening.from ?? 1020, openingTo: catalog.catalog.site.opening.to ?? 1440, nowMinute: clock.nowMinute };
  const zones = catalog.catalog.zones.map((zone) => {
    const snapshot = byZone.get(zone.id);
    const current = snapshot
      ? {
        level: Math.round(snapshot.level * 100) / 100,
        source: isMeasuredCrowd(snapshot) ? "sensor" : snapshot.source.toLowerCase(),
        confidence: snapshot.confidence,
        observedAt: snapshot.observedAt.toISOString(),
      }
      : { level: Math.round(site.crowd(zone.id, clock.nowMinute) * 100) / 100, source: "estimate", confidence: 0.3, observedAt: now.toISOString() };
    // أوقات الذروة: نموذج لكل ساعة تشغيل، والساعة الحالية بالقراءة الحية
    const forecast = zoneForecast(site, zone.id, { ...opening, liveLevel: snapshot ? snapshot.level : null });
    return { zone: zone.id, ...current, hourly: forecast.hours, quietestUpcomingHour: forecast.quietestUpcomingHour };
  });

  return jsonData(request, {
    catalogVersionId: event.publishedCatalogVersionId,
    capturedAt: now.toISOString(),
    clock,
    threshold: site.crowdThreshold,
    nextPollAfterMs: 15_000,
    zones,
  }, {
    persistence: "postgresql",
    sources: [...new Set(zones.map((row) => row.source))],
  });
}
