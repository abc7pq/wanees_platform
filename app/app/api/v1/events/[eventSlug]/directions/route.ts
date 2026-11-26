// اتجاهات المشي داخل الموقع — خطوات مرقمة على رسم المسار الحقيقي (Dijkstra في المحرك)
// كل خطوة مستندة للكتالوج المنشور: عقد routeGraph وحوافها، لا إحداثيات مختلقة.
import { Site } from "@/engine/site.ts";
import { loadSessionCatalog } from "@/lib/db-catalog";
import { jsonData, jsonError } from "@/lib/api-response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getVisitorToken, resolveVisitorSession } from "@/lib/visitor-auth";
import { prisma } from "@/lib/db";
import { loadCurrentCrowdSnapshots } from "@/lib/live-updates";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

type ResolvedPlace = {
  kind: "location" | "activity" | "zone";
  id: string;
  name: string;
  zone: string;
  zoneName: string;
  nodeId: string | null;
};

function resolvePlace(site: Site, raw: string): ResolvedPlace | null {
  const value = raw.trim();
  if (!value) return null;
  const location = site.locations.get(value);
  if (location) {
    const zone = location.zone ?? "";
    return {
      kind: "location",
      id: location.id,
      name: location.label,
      zone,
      zoneName: zone ? site.zones.get(zone)?.name ?? zone : "",
      nodeId: site.routeGraphNodes.has(location.id) ? location.id : null,
    };
  }
  const activity = site.activities.get(value);
  if (activity) {
    return {
      kind: "activity",
      id: activity.id,
      name: activity.name,
      zone: activity.zone,
      zoneName: site.zones.get(activity.zone)?.name ?? activity.zone,
      // The entrance node when the organizer set one (audit 3.4), else a node named after the activity.
      nodeId: activity.entrance_node && site.routeGraphNodes.has(activity.entrance_node) ? activity.entrance_node : site.routeGraphNodes.has(activity.id) ? activity.id : null,
    };
  }
  const zone = site.zones.get(value);
  if (zone) {
    return { kind: "zone", id: zone.id, name: zone.name, zone: zone.id, zoneName: zone.name, nodeId: site.routeGraphNodes.has(value) ? value : null };
  }
  const node = site.routeGraphNodes.get(value);
  if (node) {
    const zone = node.zone ?? "";
    return { kind: "location", id: node.id, name: node.label, zone, zoneName: site.zones.get(zone)?.name ?? zone, nodeId: node.id };
  }
  return null;
}

function defaultOriginZone(site: Site, startZoneHint: string | null): string {
  if (startZoneHint && site.zones.has(startZoneHint)) return startZoneHint;
  const entrance = [...site.routeGraphNodes.values()].find((node) => node.type === "ENTRANCE" && node.status === "open" && node.zone);
  if (entrance?.zone) return entrance.zone;
  return site.zones.keys().next().value ?? "";
}

export async function GET(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  if (!getVisitorToken(request)) return jsonError(request, "SESSION_TOKEN_REQUIRED", "يلزم رمز جلسة الزيارة.", 401);
  const session = await resolveVisitorSession(eventSlug, request);
  if (!session) return jsonError(request, "SESSION_NOT_FOUND", "جلسة الزيارة غير موجودة أو انتهت.", 404);

  const rate = await enforceRateLimit(request, { scope: `directions:${eventSlug}:${session.id}`, limit: 60 });
  if (!rate.allowed) {
    const response = jsonError(request, "RATE_LIMITED", "طلبات الاتجاهات كثيرة، حاول بعد قليل.", 429);
    response.headers.set("retry-after", String(rate.retryAfterSeconds));
    return response;
  }

  const url = new URL(request.url);
  const toParam = (url.searchParams.get("to") ?? "").trim();
  const fromParam = (url.searchParams.get("from") ?? "").trim();
  if (!toParam || toParam.length > 120 || fromParam.length > 120) return jsonError(request, "INVALID_REQUEST", "حدد الوجهة المطلوبة.", 400);

  const catalogResult = await loadSessionCatalog(eventSlug, session.catalogVersionId);
  if (!catalogResult || catalogResult.catalogVersionId !== session.catalogVersionId) {
    return jsonError(request, "CATALOG_VERSION_UNAVAILABLE", "نسخة الكتالوج المرتبطة بالجلسة غير متاحة.", 409);
  }
  const site = new Site(catalogResult.catalog);

  const target = resolvePlace(site, toParam);
  if (!target || (!target.zone && !target.nodeId)) {
    return jsonError(request, "TARGET_NOT_FOUND", "ما لقيت الوجهة في الكتالوج المنشور.", 404);
  }
  const originPlace = fromParam
    ? resolvePlace(site, fromParam)
    : resolvePlace(site, session.preferences?.startPointId ?? "");
  if (fromParam && (!originPlace || (!originPlace.zone && !originPlace.nodeId))) {
    return jsonError(request, "ORIGIN_NOT_FOUND", "ما لقيت نقطة الانطلاق في الكتالوج المنشور.", 404);
  }
  const originZoneRaw = originPlace?.zone || defaultOriginZone(site, session.preferences?.startPointId ?? null);
  if (target.nodeId && site.routeGraphNodes.get(target.nodeId)?.status !== "open") {
    return jsonError(request, "CONFLICT", "هذه الوجهة غير مفتوحة حاليًا.", 409);
  }
  if (originPlace?.nodeId && site.routeGraphNodes.get(originPlace.nodeId)?.status !== "open") {
    return jsonError(request, "CONFLICT", "نقطة الانطلاق غير مفتوحة. اختر نقطة أخرى.", 409);
  }

  const steps: Array<Record<string, unknown>> = [];
  let totalWalkMin = 0;
  let mode: "graph" | "same_zone" | "estimate" = "estimate";
  const pathNodes: Array<{ x: number; y: number }> = [];

  // نقطة انطلاق GPS حقيقية (نمط AirTag): أقرب عقدة مفتوحة لموقع الزائر الحالي
  const fromX = Number(url.searchParams.get("fromX"));
  const fromY = Number(url.searchParams.get("fromY"));
  const gpsOrigin = url.searchParams.has("fromX") && url.searchParams.has("fromY") && Number.isFinite(fromX) && Number.isFinite(fromY)
    ? { x: fromX, y: fromY }
    : null;
  let originZone = originZoneRaw;
  let fromNodeId = originPlace?.nodeId;
  if (gpsOrigin) {
    let nearest: { id: string; zone?: string; d: number } | null = null;
    for (const node of site.routeGraphNodes.values()) {
      if (node.status !== "open" || !node.zone) continue;
      const d = (node.x - gpsOrigin.x) ** 2 + (node.y - gpsOrigin.y) ** 2;
      if (!nearest || d < nearest.d) nearest = { id: node.id, zone: node.zone, d };
    }
    if (nearest?.zone) {
      originZone = nearest.zone;
      fromNodeId = nearest.id;
      steps.push({ id: "gps-you", label: "موقعك الحالي", type: "GPS", zone: null, zoneName: null, x: Math.round(gpsOrigin.x), y: Math.round(gpsOrigin.y), walkMinFromPrev: 0, sourceRef: "gps" });
    }
  }

  const zoneNode = (zone: string) => [...site.routeGraphNodes.values()]
    .filter((node) => node.zone === zone && node.status === "open")
    .sort((a, b) => Number(b.type === "ZONE") - Number(a.type === "ZONE"))[0];
  const startNodeId = fromNodeId ?? zoneNode(originZone)?.id;
  const targetNodeId = target.nodeId ?? zoneNode(target.zone)?.id;
  // زحام حي (أجهزة الزوار/المشغل): المسار يتجنب المناطق المزدحمة مثل اتجاهات القيادة الذكية
  const crowdLevels = new Map<string, number>();
  if (process.env.DATABASE_URL) {
    const snapshots = await loadCurrentCrowdSnapshots(prisma, session.eventId, catalogResult.catalogVersionId, new Date()).catch(() => []);
    for (const snapshot of snapshots) {
      if (snapshot.source !== "SIMULATED" || snapshot.eventUpdate) crowdLevels.set(snapshot.zone.stableKey, snapshot.level);
    }
  }
  const threshold = site.crowdThreshold;
  const avoidCrowds = url.searchParams.get("avoidCrowds") !== "false";
  const zonePenalty = (zoneId: string) => {
    const level = crowdLevels.get(zoneId);
    if (level == null || zoneId === target.zone) return 0;
    return level >= threshold ? 1.5 : level >= threshold * 0.65 ? 0.4 : 0;
  };
  // A wheelchair or stroller (said in the chat, or asked for here) walks step-free walkways only.
  const accessibleOnly = url.searchParams.get("accessible") === "true" || Boolean(session.preferences?.mobility);
  const path = startNodeId && targetNodeId
    ? site.pathBetweenNodes(startNodeId, targetNodeId, { ...(avoidCrowds && crowdLevels.size ? { zonePenalty } : {}), accessibleOnly })
    : null;
  if (!path && accessibleOnly && startNodeId && targetNodeId && site.pathBetweenNodes(startNodeId, targetNodeId)) {
    return jsonError(request, "CONFLICT", `ما لقيت طريق بدون درج إلى «${target.name}». اسأل خدمة الزوار عن أقرب مدخل ممهد.`, 409, { reason: "no_accessible_route" });
  }
  if (!path && !catalogResult.demoNavigation) {
    return jsonError(request, "CONFLICT", `لا يوجد مسار مشي مؤكد إلى «${target.name}» من نقطة الانطلاق هذه. اختر نقطة أخرى أو اسأل خدمة الزوار.`, 409);
  }
  if (path) {
    mode = path.nodeIds.length > 1 ? "graph" : "same_zone";
    totalWalkMin = path.minutes;
    let prev: string | undefined;
    for (const nodeId of path.nodeIds) {
      const node = site.routeGraphNodes.get(nodeId);
      if (!node) continue;
      steps.push(stepRow(node, site, prev ? site.walkMinBetweenNodes(prev, nodeId) ?? 0 : 0));
      pathNodes.push({ x: node.x, y: node.y });
      prev = nodeId;
    }
  } else if (originZone === target.zone && (!startNodeId || !targetNodeId)) {
    const zone = site.zones.get(originZone);
    mode = "same_zone";
    const anchor = target.nodeId
      ? site.routeGraphNodes.get(target.nodeId)
      : [...site.routeGraphNodes.values()].find((node) => node.zone === originZone && node.status === "open");
    if (anchor) {
      steps.push(stepRow(anchor, site, 0));
      pathNodes.push({ x: anchor.x, y: anchor.y });
    } else if (zone) {
      steps.push({ id: zone.id, label: zone.name, type: "ZONE", zone: zone.id, zoneName: zone.name, x: zone.x, y: zone.y, walkMinFromPrev: 0, sourceRef: `catalog:${catalogResult.catalogVersionId}/zone:${zone.id}` });
      pathNodes.push({ x: zone.x, y: zone.y });
    }
  } else {
    if (site.zones.has(originZone) && site.zones.has(target.zone)) {
      // لا رسم متاح بين المنطقتين — تقدير زمني بمسافة المراكز (نفس معادلة المحرك)
      totalWalkMin = site.travelMin(originZone, target.zone);
      mode = "estimate";
      const from = site.zones.get(originZone);
      const to = site.zones.get(target.zone);
      if (from) {
        steps.push({ id: from.id, label: from.name, type: "ZONE", zone: from.id, zoneName: from.name, x: from.x, y: from.y, walkMinFromPrev: 0, sourceRef: `catalog:${catalogResult.catalogVersionId}/zone:${from.id}` });
      }
      if (to) {
        steps.push({ id: to.id, label: to.name, type: "ZONE", zone: to.id, zoneName: to.name, x: to.x, y: to.y, walkMinFromPrev: totalWalkMin, sourceRef: `catalog:${catalogResult.catalogVersionId}/zone:${to.id}` });
      }
    }
  }

  const finalPathNodes = gpsOrigin && pathNodes.length ? [{ x: gpsOrigin.x, y: gpsOrigin.y }, ...pathNodes] : pathNodes;
  for (const step of steps) {
    const zone = typeof step.zone === "string" ? step.zone : null;
    const level = zone ? crowdLevels.get(zone) : undefined;
    step.crowdLevel = level ?? null;
    step.crowded = level != null && level >= threshold;
  }

  return jsonData(request, {
    eventSlug,
    catalogVersionId: catalogResult.catalogVersionId,
    origin: originPlace
      ? { kind: originPlace.kind, id: originPlace.id, name: originPlace.name, zone: originPlace.zone, zoneName: originPlace.zoneName }
      : { kind: "zone" as const, id: originZone, name: site.zones.get(originZone)?.name ?? originZone, zone: originZone, zoneName: site.zones.get(originZone)?.name ?? originZone },
    target: { kind: target.kind, id: target.id, name: target.name, zone: target.zone, zoneName: target.zoneName },
    arrival: target.nodeId ? "destination_node" : "zone",
    demoRoute: catalogResult.demoNavigation,
    totalWalkMin: mode === "graph" ? totalWalkMin : originZone === target.zone ? 0 : totalWalkMin,
    mode,
    steps,
    pathNodes: finalPathNodes,
    crowdAware: avoidCrowds && crowdLevels.size > 0,
    accessibleOnly,
    sourceRef: `catalog:${catalogResult.catalogVersionId}/route-graph`,
  });
}

function stepRow(node: { id: string; label: string; type: string; zone?: string; x: number; y: number }, site: Site, walkMinFromPrev: number) {
  return {
    id: node.id,
    label: node.label,
    type: node.type,
    zone: node.zone ?? null,
    zoneName: node.zone ? site.zones.get(node.zone)?.name ?? node.zone : null,
    x: node.x,
    y: node.y,
    walkMinFromPrev,
    sourceRef: `route-node:${node.id}`,
  };
}
