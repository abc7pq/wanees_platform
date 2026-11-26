// حالة الزائر كما يراها الوكيل: الكتالوج المنشور، ساعة الفعالية، الملف الشخصي، والمسار النشط.
// مشتركة بين بدء المكالمة الحية والتنبيهات الاستباقية.
import { Site } from "@/engine/site.ts";
import { prisma } from "@/lib/db";
import { loadPublishedEventCatalog } from "@/lib/db-catalog";
import { toEngineItinerary, type StoredItinerary } from "@/lib/assistant";
import { getEventClock } from "@/lib/event-clock";
import { resolveVisitWindow } from "@/lib/visitor-profile";

type VisitorSessionLike = {
  id: string;
  eventId: string;
  catalogVersionId: string;
  preferences: Parameters<typeof resolveVisitWindow>[1];
};

export async function loadVisitorAgentState(eventSlug: string, session: VisitorSessionLike) {
  const catalogResult = await loadPublishedEventCatalog(eventSlug);
  if (!catalogResult || catalogResult.catalogVersionId !== session.catalogVersionId) return null;
  const clock = getEventClock({
    eventSlug,
    startsAt: catalogResult.eventStartsAt,
    endsAt: catalogResult.eventEndsAt,
    timezone: catalogResult.venueTimezone,
    openingFrom: catalogResult.catalog.site.opening.from,
    openingTo: catalogResult.catalog.site.opening.to,
  });
  const visit = resolveVisitWindow(catalogResult.catalog, session.preferences, clock.nowMinute);
  const latest = await prisma.itinerary.findFirst({
    where: { sessionId: session.id, eventId: session.eventId, catalogVersionId: session.catalogVersionId, status: "active" },
    orderBy: { generatedAt: "desc" },
    include: { items: { orderBy: { sequence: "asc" }, include: { activity: { include: { zone: true } } } } },
  });
  return {
    catalogResult,
    clock,
    profile: visit.profile,
    nowMin: visit.effectiveNowMinute,
    site: new Site(catalogResult.catalog),
    plan: latest ? toEngineItinerary(latest as unknown as StoredItinerary, catalogResult.catalog, visit.profile) : null,
  };
}
