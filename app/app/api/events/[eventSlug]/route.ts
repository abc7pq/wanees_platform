import { NextResponse } from "next/server";
import { loadActiveCatalog } from "@/lib/venues.ts";
import { loadPublishedEventCatalog } from "@/lib/db-catalog";
import { getPublicFeatureFlags } from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ eventSlug: string }> },
) {
  const { eventSlug } = await context.params;
  const dbResult = await loadPublishedEventCatalog(eventSlug);
  if (dbResult) {
    return NextResponse.json({
      data: dbResult,
      meta: { persistence: "postgresql", catalogVersionId: dbResult.catalogVersionId, features: getPublicFeatureFlags() },
    });
  }

  if (eventSlug !== "boulevard-world-demo" && eventSlug !== "boulevard_world") {
    return NextResponse.json({ error: "event not found" }, { status: 404 });
  }

  const catalog = loadActiveCatalog();
  return NextResponse.json({
    data: {
      eventId: "json-boulevard-world-demo",
      eventSlug: "boulevard-world-demo",
      eventName: catalog.site.name,
      catalogVersionId: "json-fixture-v1",
      catalog,
    },
    meta: {
      persistence: "json-fallback",
      features: getPublicFeatureFlags(),
      warning: "PostgreSQL is not available; this is demo fixture data.",
    },
  });
}
