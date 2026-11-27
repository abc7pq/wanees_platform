// «حولي» (audit 2.2, 3.1, 3.2): the nearest places of one category, by real walking minutes from where
// the visitor is. The phone sends only the walkway node it snapped to; the server validates it.
import { Site } from "@/engine/site.ts";
import { loadSessionCatalog } from "@/lib/db-catalog";
import { jsonData, jsonError } from "@/lib/api-response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getVisitorToken, resolveVisitorSession } from "@/lib/visitor-auth";
import { categoryLabel, nearestCalm, nearestInCategory, PLACE_CATEGORIES, type PlaceCategory } from "@/lib/place-categories";
import { originPhrase, resolvePosition, spokenPositionValid, visitorPositionSchema } from "@/lib/visitor-position";
import { kioskPosition } from "@/lib/kiosk";
import { readAssistantContext } from "@/lib/assistant-context";
import { likelyOrigin } from "@/lib/walking-brief";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

const CATEGORIES = new Set<string>(PLACE_CATEGORIES.map((definition) => definition.category));

export async function GET(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  if (!getVisitorToken(request)) return jsonError(request, "SESSION_TOKEN_REQUIRED", "يلزم رمز جلسة الزيارة.", 401);
  const session = await resolveVisitorSession(eventSlug, request);
  if (!session) return jsonError(request, "SESSION_NOT_FOUND", "جلسة الزيارة غير موجودة أو انتهت.", 404);
  const rate = await enforceRateLimit(request, { scope: `nearby:${eventSlug}:${session.id}`, limit: 60 });
  if (!rate.allowed) {
    const response = jsonError(request, "RATE_LIMITED", "طلبات كثيرة، حاول بعد قليل.", 429);
    response.headers.set("retry-after", String(rate.retryAfterSeconds));
    return response;
  }

  const url = new URL(request.url);
  const category = url.searchParams.get("category") ?? "";
  if (!CATEGORIES.has(category)) return jsonError(request, "INVALID_REQUEST", "اختر نوع المكان.", 400, { field: "category" });
  const english = url.searchParams.get("lang") === "en";
  const nodeId = url.searchParams.get("nodeId");
  const parsedPosition = nodeId
    ? visitorPositionSchema.safeParse({
      nodeId,
      source: url.searchParams.get("source") ?? "gps",
      capturedAt: url.searchParams.get("capturedAt") ?? "",
      ...(url.searchParams.has("accuracyM") ? { accuracyM: Number(url.searchParams.get("accuracyM")) } : {}),
    })
    : null;
  if (parsedPosition && !parsedPosition.success) return jsonError(request, "INVALID_REQUEST", "بيانات الموقع غير صالحة.", 400, { field: "position" });

  const catalogResult = await loadSessionCatalog(eventSlug, session.catalogVersionId);
  if (!catalogResult || catalogResult.catalogVersionId !== session.catalogVersionId) {
    return jsonError(request, "CATALOG_VERSION_UNAVAILABLE", "نسخة الكتالوج المرتبطة بالجلسة غير متاحة.", 409);
  }
  const site = new Site(catalogResult.catalog);
  const now = new Date();
  // A kiosk counts from its own node, whatever the query says (audit 5.2).
  const atKiosk = kioskPosition(session, now);
  const requested = atKiosk ?? (parsedPosition?.success ? parsedPosition.data : null);
  const device = requested ? resolvePosition(site, requested, now) : null;
  const storedContext = readAssistantContext(session.assistantContext, session.assistantContextExpiresAt, now);
  const spokenZone = atKiosk ? null : spokenPositionValid(storedContext?.spokenPosition, now, site);

  let origin: { zone: string; source: "gps" | "kiosk" | "spoken" | "stop" | "start_point" | "entrance" | "first_stop"; name: string } | null = null;
  if (device?.ok) origin = { zone: device.position.zone, source: device.position.source, name: device.position.label };
  else if (spokenZone) origin = { zone: spokenZone, source: "spoken", name: site.zones.get(spokenZone)?.name ?? spokenZone };
  else {
    // No position: the zone of the stop under way (sent by the app from its plan), else the start point or the gate.
    const stopZone = url.searchParams.get("stopZone");
    if (stopZone && site.zones.has(stopZone)) origin = { zone: stopZone, source: "stop", name: site.zones.get(stopZone)?.name ?? stopZone };
    else {
      const fallback = likelyOrigin(site, [], 0, session.preferences?.startPointId);
      if (fallback) origin = { zone: fallback.zone, source: fallback.source, name: site.zones.get(fallback.zone)?.name ?? fallback.zone };
    }
  }

  const kind = category as PlaceCategory;
  let places = nearestInCategory(site, kind, origin?.zone ?? null, 3);
  const calmInstead = kind === "seating" && !places.length;
  if (calmInstead) places = nearestCalm(site, origin?.zone ?? null, 3);
  return jsonData(request, {
    category: kind,
    label: categoryLabel(kind, english ? "en" : "ar"),
    calmInstead,
    origin: origin ? { zone: origin.zone, source: origin.source, name: origin.name, phrase: originPhrase(origin.source, origin.name, english) } : null,
    ...(device && !device.ok ? { positionRejected: device.reason } : {}),
    results: places.map((place) => ({
      id: place.id,
      kind: place.member.kind,
      name: place.member.kind === "activity" && english ? place.member.activity.name_en ?? place.name : place.name,
      zone: place.zone,
      zoneName: site.zones.get(place.zone)?.name ?? place.zone,
      walkMin: place.walkMin,
      nodeId: place.member.nodeId,
      sourceRef: `catalog:${session.catalogVersionId}/${place.member.kind}:${place.id}`,
    })),
  }, { catalogVersionId: session.catalogVersionId });
}
