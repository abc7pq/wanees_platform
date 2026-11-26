import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeEventRequest } from "@/lib/catalog-auth";
import { enforceAdminRateLimit, isSameOrigin } from "@/lib/request-security";
import { withAdminApiContract } from "@/lib/api-response";

type Context = { params: Promise<{ eventSlug: string }> };

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export const POST = withAdminApiContract(async function POST(request: Request, context: Context) {
  if (!isSameOrigin(request)) return errorResponse("FORBIDDEN", "تعذر التحقق من مصدر الطلب.", 403);
  const rate = await enforceAdminRateLimit(request, "catalog-edge", 90);
  if (!rate.allowed) return errorResponse("RATE_LIMITED", "انتظر قليلًا قبل حفظ مقطع آخر.", 429);
  const { eventSlug } = await context.params;
  const access = await authorizeEventRequest(request, eventSlug, ["OWNER", "ADMIN", "EDITOR"]);
  if (!access.authorized) return errorResponse(access.userId ? "FORBIDDEN" : "UNAUTHORIZED", "يتطلب حفظ الممر صلاحية تحرير الكتالوج.", access.userId ? 403 : 401);
  if (!access.event) return errorResponse("EVENT_NOT_FOUND", "الفعالية غير موجودة.", 404);

  const body = await request.json().catch(() => null);
  const fromNodeId = typeof body?.fromNodeId === "string" ? body.fromNodeId : "";
  const toNodeId = typeof body?.toNodeId === "string" ? body.toNodeId : "";
  const versionId = typeof body?.versionId === "string" ? body.versionId : "";
  const locator = typeof body?.source === "string" ? body.source.trim() : "";
  const { distanceM, walkMin, accessible, status, walkedOn } = body ?? {};
  const observedAt = typeof walkedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(walkedOn) ? new Date(walkedOn + "T00:00:00.000Z") : null;
  if (!versionId || !fromNodeId || !toNodeId || fromNodeId === toNodeId ||
      !Number.isInteger(distanceM) || distanceM < 1 || distanceM > 25000 ||
      !Number.isInteger(walkMin) || walkMin < 1 || walkMin > 480 ||
      typeof accessible !== "boolean" || !["open", "closed"].includes(status) ||
      !locator || locator.length > 240 || !observedAt || Number.isNaN(observedAt.getTime()) ||
      observedAt.toISOString().slice(0, 10) !== walkedOn || observedAt > new Date()) {
    return errorResponse("INVALID_REQUEST", "اختر موقعين وأدخل المسافة والمدة وتاريخ الجولة ومرجع القياس.", 400);
  }

  const { id: eventId, organizationId } = access.event;
  const saved = await prisma.$transaction(async (tx) => {
    const drafts = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "CatalogVersion"
      WHERE "id" = ${versionId} AND "eventId" = ${eventId} AND "status" IN ('DRAFT', 'REJECTED')
      FOR UPDATE
    `;
    if (!drafts.length) return "locked";
    const nodes = await tx.routeNode.findMany({
      where: { catalogVersionId: versionId, id: { in: [fromNodeId, toNodeId] } },
      select: { id: true, label: true },
    });
    const from = nodes.find((node) => node.id === fromNodeId);
    const to = nodes.find((node) => node.id === toNodeId);
    if (!from || !to) return "missing";
    const key = { catalogVersionId: versionId, fromNodeId, toNodeId };
    const previous = await tx.routeEdge.findUnique({ where: { catalogVersionId_fromNodeId_toNodeId: key } });
    if (previous?.sourceId && previous.distanceM === distanceM && previous.walkMin === walkMin &&
        previous.accessible === accessible && previous.status === status) {
      const source = await tx.contentSource.findUnique({ where: { id: previous.sourceId } });
      if (source && source.locator === locator && source.observedAt?.getTime() === observedAt.getTime() && source.reviewStatus === "VERIFIED") return previous;
    }
    const source = await tx.contentSource.create({
      data: {
        catalogVersionId: versionId, sourceType: "operator_route_edge", title: `قياس الممر من ${from.label} إلى ${to.label}`,
        locator, observedAt, reviewStatus: "VERIFIED", trustLevel: "operator_verified",
      },
    });
    const data = { distanceM, walkMin, accessible, status, sourceId: source.id };
    const edge = await tx.routeEdge.upsert({
      where: { catalogVersionId_fromNodeId_toNodeId: key },
      create: { ...key, ...data },
      update: data,
    });
    await tx.catalogVersion.update({
      where: { id: versionId }, data: { status: "DRAFT", validationReport: { valid: false, editRevision: randomUUID() } },
    });
    await tx.auditLog.create({ data: {
      organizationId, actorUserId: access.userId ?? undefined, action: "catalog_route_edge.save",
      entityType: "RouteEdge", entityId: edge.id,
      afterSummary: { fromNodeId, toNodeId, ...data },
    } });
    return edge;
  });
  if (saved === "locked") return errorResponse("VERSION_LOCKED", "يمكن تعديل الممرات في مسودة الفعالية فقط.", 409);
  if (saved === "missing") return errorResponse("ROUTE_NODE_NOT_FOUND", "يجب أن يكون الموقعان في المسودة نفسها.", 404);
  return NextResponse.json({ data: saved, meta: { persistence: "postgresql" } });
});
