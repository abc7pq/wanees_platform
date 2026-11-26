import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { enforceAdminRateLimit, isSameOrigin } from "@/lib/request-security";
import { authorizeEventRequest } from "@/lib/catalog-auth";
import { withAdminApiContract } from "@/lib/api-response";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function stableKey(value: unknown, fallback: string) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") : "";
  return (normalized || fallback).slice(0, 80);
}

export const POST = withAdminApiContract(async function POST(request: Request, context: Context) {
  if (!isSameOrigin(request)) return errorResponse("FORBIDDEN", "تعذر التحقق من مصدر الطلب.", 403);
  const rate = await enforceAdminRateLimit(request, "catalog-location", 90);
  if (!rate.allowed) return errorResponse("RATE_LIMITED", "انتظر قليلًا قبل حفظ موقع آخر.", 429);
  const { eventSlug } = await context.params;
  const access = await authorizeEventRequest(request, eventSlug, ["OWNER", "ADMIN", "EDITOR"]);
  if (!access.authorized) return errorResponse(access.userId ? "FORBIDDEN" : "UNAUTHORIZED", access.userId ? "صلاحية تحرير الكتالوج مطلوبة." : "غير مصرح.", access.userId ? 403 : 401);
  if (!access.event) return errorResponse("EVENT_NOT_FOUND", "الفعالية غير موجودة.", 404);

  const body = await request.json().catch(() => ({}));
  const versionId = typeof body?.versionId === "string" ? body.versionId : null;
  const version = versionId
    ? await prisma.catalogVersion.findFirst({ where: { id: versionId, eventId: access.event.id }, select: { id: true, status: true } })
    : await prisma.catalogVersion.findFirst({ where: { eventId: access.event.id, status: { in: ["DRAFT", "REJECTED"] } }, orderBy: { versionNumber: "desc" }, select: { id: true, status: true } });
  if (!version) return errorResponse("DRAFT_NOT_FOUND", "أنشئ أو اختر نسخة draft أولًا.", 409);
  if (version.status !== "DRAFT" && version.status !== "REJECTED") return errorResponse("VERSION_LOCKED", "لا يمكن تعديل نسخة منشورة.", 409);

  const label = typeof body?.label === "string" ? body.label.trim().slice(0, 240) : "";
  if (!label) return errorResponse("INVALID_REQUEST", "اسم الموقع مطلوب.", 400);
  const type = ["ENTRANCE", "ZONE", "ACTIVITY", "LANDMARK", "SERVICE"].includes(body?.type) ? body.type : "SERVICE";
  const zoneStableKey = typeof body?.zoneStableKey === "string" ? body.zoneStableKey.trim() : "";
  const zone = zoneStableKey ? await prisma.zone.findFirst({ where: { catalogVersionId: version.id, stableKey: zoneStableKey }, select: { id: true } }) : null;
  if (zoneStableKey && !zone) return errorResponse("ZONE_NOT_FOUND", "المنطقة غير موجودة في هذه المسودة.", 404);
  const data = {
    stableKey: stableKey(body?.stableKey, `location-${Date.now()}`),
    type,
    label,
    description: typeof body?.description === "string" ? body.description.trim().slice(0, 1000) : null,
    aliases: Array.isArray(body?.aliases) ? body.aliases.filter((item: unknown): item is string => typeof item === "string").map((item: string) => item.trim()).filter(Boolean).slice(0, 20) : [],
    x: typeof body?.x === "number" && Number.isFinite(body.x) ? body.x : 0,
    y: typeof body?.y === "number" && Number.isFinite(body.y) ? body.y : 0,
    accessible: body?.accessible !== false,
    status: typeof body?.status === "string" && body.status.trim() ? body.status.trim().slice(0, 32) : "open",
    zoneId: zone?.id ?? null,
  } as const;

  try {
    const existingId = typeof body?.id === "string" ? body.id : null;
    if (existingId) {
      const existing = await prisma.routeNode.findFirst({ where: { id: existingId, catalogVersionId: version.id }, select: { id: true } });
      if (!existing) return errorResponse("ROUTE_NODE_NOT_FOUND", "الموقع غير موجود في هذه المسودة.", 404);
    }
    const saved = await prisma.$transaction(async (tx) => {
      // Any edit invalidates the last validation report so publish needs a fresh check.
      const locked = await tx.catalogVersion.updateMany({
        where: { id: version.id, eventId: access.event!.id, status: { in: ["DRAFT", "REJECTED"] } },
        data: { status: "DRAFT", validationReport: { valid: false, editRevision: randomUUID() } },
      });
      if (!locked.count) return null;
      const node = existingId
        ? await tx.routeNode.update({ where: { id: existingId }, data: { ...data, catalogVersionId: version.id } })
        : await tx.routeNode.create({ data: { catalogVersionId: version.id, ...data } });
      await tx.auditLog.create({ data: { organizationId: access.event!.organizationId, actorUserId: access.userId ?? undefined, action: existingId ? "catalog_route_node.update" : "catalog_route_node.create", entityType: "RouteNode", entityId: node.id, afterSummary: { stableKey: node.stableKey, type: node.type, versionId: version.id } } });
      return node;
    });
    if (!saved) return errorResponse("VERSION_LOCKED", "لا يمكن تعديل نسخة منشورة.", 409);
    return NextResponse.json({ data: saved, meta: { persistence: "postgresql" } }, { status: existingId ? 200 : 201 });
  } catch {
    return errorResponse("ROUTE_NODE_SAVE_FAILED", "تعذر حفظ الموقع؛ تأكد من أن المعرف غير مستخدم في هذه المسودة.", 409);
  }
});
