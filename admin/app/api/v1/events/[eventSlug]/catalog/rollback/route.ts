import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeEventRequest } from "@/lib/catalog-auth";
import { enforceAdminRateLimit, isSameOrigin } from "@/lib/request-security";
import { withAdminApiContract } from "@/lib/api-response";
import { crosswalkRefusal, crosswalkWhere, isCrosswalkDatabaseRefusal } from "@/lib/catalog-crosswalk-gate";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export const POST = withAdminApiContract(async function POST(request: Request, context: Context) {
  if (!isSameOrigin(request)) return errorResponse("FORBIDDEN", "الطلب غير صادر من مصدر موثوق.", 403);
  const rate = await enforceAdminRateLimit(request, "catalog-rollback", 20);
  if (!rate.allowed) return errorResponse("RATE_LIMITED", "تم تجاوز عدد محاولات الاستعادة. حاول بعد قليل.", 429);

  const { eventSlug } = await context.params;
  const access = await authorizeEventRequest(request, eventSlug, ["OWNER", "ADMIN"]);
  if (!access.authorized) return errorResponse(access.userId ? "FORBIDDEN" : "UNAUTHORIZED", access.userId ? "صلاحية استعادة الكتالوج مطلوبة." : "غير مصرح.", access.userId ? 403 : 401);
  if (!access.event) return errorResponse("EVENT_NOT_FOUND", "الفعالية غير موجودة.", 404);

  const body = await request.json().catch(() => ({}));
  const versionId = typeof body?.versionId === "string" ? body.versionId : "";
  if (!versionId) return errorResponse("INVALID_REQUEST", "versionId مطلوب.", 400);

  const target = await prisma.catalogVersion.findFirst({ where: { id: versionId, eventId: access.event.id }, select: { id: true, versionNumber: true, status: true, crosswalkStatus: true, crosswalkChecksum: true } });
  if (!target) return errorResponse("VERSION_NOT_FOUND", "نسخة الكتالوج غير موجودة.", 404);
  if (target.status !== "SUPERSEDED") return errorResponse("VERSION_NOT_ROLLBACKABLE", "يمكن استعادة نسخة منشورة سابقًا فقط.", 409);
  if (access.event.publishedCatalogVersionId === target.id) return errorResponse("VERSION_ALREADY_ACTIVE", "هذه النسخة منشورة حاليًا.", 409);
  const refusal = crosswalkRefusal(target, body?.crosswalkChecksum);
  if (refusal) return errorResponse(refusal.code, refusal.message, 409);

  const restoredAt = new Date();
  const changed = new Error("CATALOG_CHANGED");
  const restored = await prisma.$transaction(async (tx) => {
    const currentId = access.event!.publishedCatalogVersionId;
    if (currentId && currentId !== target.id) {
      await tx.catalogVersion.update({ where: { id: currentId }, data: { status: "SUPERSEDED" } });
    }
    const gated = await tx.catalogVersion.updateMany({
      where: { id: target.id, status: "SUPERSEDED", ...crosswalkWhere(target) },
      data: { status: "PUBLISHED", publishedAt: restoredAt, publishedById: access.userId ?? undefined },
    });
    if (!gated.count) throw changed;
    const version = await tx.catalogVersion.findUniqueOrThrow({ where: { id: target.id } });
    await tx.event.update({ where: { id: access.event!.id }, data: { publishedCatalogVersionId: version.id } });
    await tx.auditLog.create({
      data: {
        organizationId: access.event!.organizationId,
        actorUserId: access.userId ?? undefined,
        action: "catalog_version.rollback",
        entityType: "CatalogVersion",
        entityId: version.id,
        afterSummary: { fromVersionId: currentId, restoredVersionId: version.id, versionNumber: version.versionNumber, restoredAt: restoredAt.toISOString(), crosswalkStatus: version.crosswalkStatus },
      },
    });
    return version;
  }).catch((error) => {
    if (error === changed || isCrosswalkDatabaseRefusal(error)) return null;
    throw error;
  });
  if (!restored) return errorResponse("VERSION_CHANGED", "تغيّرت النسخة أو حالة مطابقتها. أعد التحميل قبل الاستعادة.", 409);

  return NextResponse.json({ data: { id: restored.id, versionNumber: restored.versionNumber, status: restored.status, publishedAt: restored.publishedAt?.toISOString() ?? null }, meta: { persistence: "postgresql" } });
});
