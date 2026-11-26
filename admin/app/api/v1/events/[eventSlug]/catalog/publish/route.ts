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
  const rate = await enforceAdminRateLimit(request, "catalog-publish", 20);
  if (!rate.allowed) return errorResponse("RATE_LIMITED", "تم تجاوز عدد محاولات النشر. حاول بعد قليل.", 429);
  const { eventSlug } = await context.params;
  const access = await authorizeEventRequest(request, eventSlug, ["OWNER", "ADMIN"]);
  if (!access.authorized) return errorResponse(access.userId ? "FORBIDDEN" : "UNAUTHORIZED", access.userId ? "صلاحية نشر الكتالوج مطلوبة." : "غير مصرح.", access.userId ? 403 : 401);
  if (!access.event) return errorResponse("EVENT_NOT_FOUND", "الفعالية غير موجودة.", 404);
  const body = await request.json().catch(() => ({}));
  const versionId = typeof body?.versionId === "string" ? body.versionId : null;
  if (!versionId) return errorResponse("INVALID_REQUEST", "versionId مطلوب.", 400);

  const version = await prisma.catalogVersion.findFirst({ where: { id: versionId, eventId: access.event.id } });
  if (!version) return errorResponse("VERSION_NOT_FOUND", "نسخة الكتالوج غير موجودة.", 404);
  if (version.status !== "DRAFT") return errorResponse("VERSION_NOT_PUBLISHABLE", "تحقق من نسخة draft قبل نشرها.", 409);
  const refusal = crosswalkRefusal(version, body?.crosswalkChecksum);
  if (refusal) return errorResponse(refusal.code, refusal.message, 409);
  const report = version.validationReport && typeof version.validationReport === "object" && !Array.isArray(version.validationReport)
    ? version.validationReport as { valid?: boolean }
    : null;
  if (!report?.valid) return errorResponse("VALIDATION_REQUIRED", "يجب أن تمر النسخة بالتحقق بنجاح قبل النشر.", 409);

  const publishedAt = new Date();
  const { id: eventId, organizationId, publishedCatalogVersionId } = access.event;
  const changed = new Error("CATALOG_CHANGED");
  const published = await prisma.$transaction(async (tx) => {
    // Publish the version first, re-checking the crosswalk in the same
    // statement, then move the event pointer. Both roll back together.
    const current = await tx.catalogVersion.updateMany({
      where: { id: version.id, status: "DRAFT", validationReport: { path: ["valid"], equals: true }, ...crosswalkWhere(version) },
      data: { status: "PUBLISHED", publishedAt, publishedById: access.userId ?? undefined },
    });
    if (!current.count) throw changed;
    const event = await tx.event.updateMany({
      where: { id: eventId, publishedCatalogVersionId },
      data: { publishedCatalogVersionId: version.id },
    });
    if (!event.count) throw changed;
    if (publishedCatalogVersionId) {
      await tx.catalogVersion.update({ where: { id: publishedCatalogVersionId }, data: { status: "SUPERSEDED" } });
    }
    await tx.event.updateMany({ where: { id: eventId, status: "DRAFT" }, data: { status: "PUBLISHED" } });
    await tx.auditLog.create({
      data: {
        organizationId,
        actorUserId: access.userId ?? undefined,
        action: "catalog_version.publish",
        entityType: "CatalogVersion",
        entityId: version.id,
        afterSummary: { versionNumber: version.versionNumber, publishedAt: publishedAt.toISOString(), crosswalkStatus: version.crosswalkStatus, crosswalkChecksum: version.crosswalkChecksum },
      },
    });
    return true;
  }).catch((error) => {
    if (error === changed || isCrosswalkDatabaseRefusal(error)) return false;
    throw error;
  });
  if (!published) return errorResponse("VERSION_CHANGED", "تغيّرت المسودة أو النسخة المنشورة. أعد التحقق قبل النشر.", 409);
  return NextResponse.json({ data: { id: version.id, versionNumber: version.versionNumber, status: "PUBLISHED", publishedAt: publishedAt.toISOString() }, meta: { persistence: "postgresql" } });
});
