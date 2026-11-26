import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { authorizeEventRequest } from "@/lib/catalog-auth";
import { enforceAdminRateLimit, isSameOrigin } from "@/lib/request-security";
import { crosswalkValidationError } from "@/lib/catalog-crosswalk-gate";
import { withAdminApiContract } from "@/lib/api-response";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export const POST = withAdminApiContract(async function POST(request: Request, context: Context) {
  if (!isSameOrigin(request)) return errorResponse("FORBIDDEN", "الطلب غير صادر من مصدر موثوق.", 403);
  const rate = await enforceAdminRateLimit(request, "catalog-validate", 30);
  if (!rate.allowed) return errorResponse("RATE_LIMITED", "تم تجاوز عدد محاولات التحقق. حاول بعد قليل.", 429);
  const { eventSlug } = await context.params;
  const access = await authorizeEventRequest(request, eventSlug, ["OWNER", "ADMIN", "EDITOR"]);
  if (!access.authorized) return errorResponse(access.userId ? "FORBIDDEN" : "UNAUTHORIZED", access.userId ? "صلاحية تحرير الكتالوج مطلوبة." : "غير مصرح.", access.userId ? 403 : 401);
  if (!access.event) return errorResponse("EVENT_NOT_FOUND", "الفعالية غير موجودة.", 404);

  const body = await request.json().catch(() => ({}));
  const versionId = typeof body?.versionId === "string" ? body.versionId : null;
  const version = versionId
    ? await prisma.catalogVersion.findFirst({ where: { id: versionId, eventId: access.event.id }, include: { zones: true, activities: { include: { schedules: true } }, routeNodes: true, routeEdges: true, contentSources: true } })
    : await prisma.catalogVersion.findFirst({ where: { eventId: access.event.id, status: "DRAFT" }, orderBy: { versionNumber: "desc" }, include: { zones: true, activities: { include: { schedules: true } }, routeNodes: true, routeEdges: true, contentSources: true } });
  if (!version) return errorResponse("DRAFT_NOT_FOUND", "لم نجد نسخة draft قابلة للتحقق.", 404);
  if (version.status !== "DRAFT" && version.status !== "REJECTED") return errorResponse("VERSION_LOCKED", "هذه النسخة غير قابلة للتعديل في حالتها الحالية.", 409);

  const errors: Array<{ code: string; message: string; entity?: string }> = [];
  const warnings: Array<{ code: string; message: string; entity?: string }> = [];
  const crosswalkError = crosswalkValidationError(version);
  if (crosswalkError) errors.push(crosswalkError);
  if (!version.zones.length) errors.push({ code: "NO_ZONES", message: "الكتالوج يحتاج منطقة واحدة على الأقل." });
  if (!version.activities.length) errors.push({ code: "NO_ACTIVITIES", message: "الكتالوج يحتاج نشاطًا واحدًا على الأقل." });
  if (!version.contentSources.length) errors.push({ code: "NO_CONTENT_SOURCES", message: "كل كتالوج منشور يحتاج مصدرًا واحدًا على الأقل." });
  for (const source of version.contentSources) {
    if (source.reviewStatus !== "VERIFIED") {
      errors.push({
        code: source.reviewStatus === "REJECTED" ? "CONTENT_SOURCE_REJECTED" : "CONTENT_SOURCE_UNREVIEWED",
        message: source.reviewStatus === "REJECTED" ? "يوجد مصدر مرفوض؛ صححه أو أزله قبل النشر." : "يوجد مصدر لم تتم مراجعته؛ اعتمده قبل النشر.",
        entity: source.title,
      });
    }
  }
  const checkedWalkSources = new Set(version.contentSources
    .filter((source) => source.sourceType === "operator_route_edge" && source.reviewStatus === "VERIFIED" &&
      (!source.validUntil || source.validUntil > new Date()))
    .map((source) => source.id));
  const fixture = version.contentSources.some((source) => source.sourceType === "fixture");
  for (const edge of version.routeEdges) {
    if (!fixture && edge.status === "open" && (!edge.sourceId || !checkedWalkSources.has(edge.sourceId))) {
      errors.push({ code: "WALK_SOURCE_REQUIRED", message: "الممر المفتوح يحتاج إلى مرجع جولة ميدانية معتمد.", entity: edge.id });
    }
  }
  for (const zone of version.zones) {
    if (zone.sourceRefs.length && zone.reviewStatus !== "VERIFIED") errors.push({ code: "ZONE_REVIEW_REQUIRED", message: "منطقة مستوردة تحتاج مراجعة المصدر قبل النشر.", entity: zone.stableKey });
  }
  for (const activity of version.activities) {
    if (activity.sourceRefs.length && activity.reviewStatus !== "VERIFIED") errors.push({ code: "ACTIVITY_REVIEW_REQUIRED", message: "نشاط مستورد يحتاج مراجعة المصدر قبل النشر.", entity: activity.stableKey });
  }
  if (!version.routeNodes.length) errors.push({ code: "NO_ROUTE_NODES", message: "الكتالوج يحتاج عقد خريطة قبل النشر." });
  if (version.routeNodes.length && !version.routeEdges.length) errors.push({ code: "NO_ROUTE_EDGES", message: "الكتالوج يحتاج حوافًا في شبكة الحركة قبل النشر." });
  const nodeIds = new Set(version.routeNodes.map((node) => node.id));
  const entranceNodes = version.routeNodes.filter((node) => node.type === "ENTRANCE");
  if (version.routeNodes.length && !entranceNodes.length) errors.push({ code: "NO_ENTRANCE_NODE", message: "شبكة الحركة تحتاج عقدة دخول واحدة على الأقل." });
  for (const node of version.routeNodes) {
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) errors.push({ code: "NODE_COORDINATES_INVALID", message: "إحداثيات عقدة الخريطة غير صالحة.", entity: node.stableKey });
  }
  const adjacency = new Map<string, string[]>();
  for (const edge of version.routeEdges) {
    if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId)) errors.push({ code: "EDGE_NODE_MISSING", message: "الحافة تشير إلى عقدة غير موجودة.", entity: edge.id });
    if (edge.distanceM <= 0 || edge.walkMin <= 0) errors.push({ code: "EDGE_DISTANCE_INVALID", message: "مسافة أو مدة المشي في الحافة غير صالحة.", entity: edge.id });
    if (edge.status === "open") adjacency.set(edge.fromNodeId, [...(adjacency.get(edge.fromNodeId) ?? []), edge.toNodeId]);
  }
  if (entranceNodes.length) {
    const reachable = new Set<string>(entranceNodes.map((node) => node.id));
    const queue = [...reachable];
    while (queue.length) {
      const current = queue.shift()!;
      for (const next of adjacency.get(current) ?? []) if (!reachable.has(next)) { reachable.add(next); queue.push(next); }
    }
    for (const zone of version.zones) {
      const zoneNodes = version.routeNodes.filter((node) => node.zoneId === zone.id);
      if (zoneNodes.length && !zoneNodes.some((node) => reachable.has(node.id))) warnings.push({ code: "ZONE_UNREACHABLE", message: "المنطقة لا يمكن الوصول إليها من عقد الدخول عبر الحواف المفتوحة.", entity: zone.stableKey });
    }
  }
  const zoneIds = new Set(version.zones.map((zone) => zone.id));
  for (const activity of version.activities) {
    if (!zoneIds.has(activity.zoneId)) errors.push({ code: "ACTIVITY_ZONE_MISSING", message: "النشاط مرتبط بمنطقة غير موجودة.", entity: activity.stableKey });
    if (activity.durationMin <= 0 || activity.durationMin > 24 * 60) errors.push({ code: "INVALID_DURATION", message: "مدة النشاط غير صالحة.", entity: activity.stableKey });
    if (activity.priceMinCents !== null && activity.priceMinCents < 0) errors.push({ code: "INVALID_PRICE", message: "السعر الأدنى لا يمكن أن يكون سالبًا.", entity: activity.stableKey });
    if (activity.priceMinCents !== null && activity.priceMaxCents !== null && activity.priceMinCents > activity.priceMaxCents) errors.push({ code: "PRICE_RANGE_INVALID", message: "نطاق السعر غير منطقي.", entity: activity.stableKey });
    if (!activity.schedules.length) errors.push({ code: "NO_SCHEDULE", message: "النشاط يحتاج جدول تشغيل قبل النشر.", entity: activity.stableKey });
    for (const schedule of activity.schedules) {
      if (schedule.endsAt <= schedule.startsAt) errors.push({ code: "SCHEDULE_INVALID", message: "نهاية الجدول يجب أن تكون بعد بدايته.", entity: activity.stableKey });
    }
  }
  const report = { valid: errors.length === 0, errors, warnings, checkedAt: new Date().toISOString(), counts: { zones: version.zones.length, activities: version.activities.length, routeNodes: version.routeNodes.length, routeEdges: version.routeEdges.length } };
  const status = errors.length ? "REJECTED" : "DRAFT";
  const updated = await prisma.$transaction(async (tx) => {
    const stored = await tx.catalogVersion.updateMany({
      where: {
        id: version.id, status: version.status, crosswalkStatus: version.crosswalkStatus,
        validationReport: { equals: version.validationReport === null ? Prisma.AnyNull : version.validationReport },
      },
      data: { status, validationReport: report },
    });
    if (!stored.count) return false;
    await tx.auditLog.create({
      data: {
        organizationId: access.event!.organizationId,
        actorUserId: access.userId ?? undefined,
        action: "catalog_version.validate",
        entityType: "CatalogVersion",
        entityId: version.id,
        afterSummary: report as any,
      },
    });
    return true;
  });
  if (!updated) return errorResponse("VERSION_CHANGED", "تغيّرت المسودة أثناء التحقق. أعد التحقق من النسخة الحالية.", 409);
  return NextResponse.json({ data: { id: version.id, versionNumber: version.versionNumber, status, report }, meta: { persistence: "postgresql" } });
});
