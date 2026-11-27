import { loadActiveCatalog } from "@/lib/venues.ts";
import { loadPublishedEventCatalog } from "@/lib/db-catalog";
import { jsonData, jsonError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

export async function GET(_request: Request, context: Context) {
  const { eventSlug } = await context.params;
  const dbResult = await loadPublishedEventCatalog(eventSlug);
  if (dbResult) {
    return jsonData(_request, {
        eventSlug,
        catalogVersionId: dbResult.catalogVersionId,
        demoNavigation: dbResult.demoNavigation,
        navigation: dbResult.navigation,
        zones: dbResult.catalog.zones.map((zone) => ({ id: zone.id, name: zone.name, x: zone.x, y: zone.y })),
        locations: dbResult.catalog.locations ?? [],
        routeGraph: dbResult.catalog.routeGraph ?? null,
      }, { persistence: "postgresql" });
  }

  if (eventSlug !== "boulevard-world-demo" && eventSlug !== "boulevard_world") {
    return jsonError(_request, "EVENT_NOT_FOUND", "الفعالية غير موجودة.", 404);
  }

  return jsonData(_request, {
      eventSlug: "boulevard-world-demo",
      catalogVersionId: "json-fixture-v1",
      demoNavigation: true,
      navigation: { liveGuidance: false, accuracy: "approximate", simulation: false, calibration: null },
      zones: loadActiveCatalog().zones.map((zone) => ({ id: zone.id, name: zone.name, x: zone.x, y: zone.y })),
      locations: [],
      routeGraph: null,
    }, { persistence: "json-fallback", warning: "PostgreSQL is not available; this is demo fixture data." });
}
