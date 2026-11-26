import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { authorizeEventRequest } from "@/lib/catalog-auth";
import { enforceAdminRateLimit, isSameOrigin } from "@/lib/request-security";
import { withAdminApiContract } from "@/lib/api-response";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export const POST = withAdminApiContract(async function POST(request: Request, context: Context) {
  if (!isSameOrigin(request)) return errorResponse("FORBIDDEN", "الطلب غير صادر من مصدر موثوق.", 403);
  const rate = await enforceAdminRateLimit(request, "catalog-review", 60);
  if (!rate.allowed) return errorResponse("RATE_LIMITED", "تم تجاوز عدد محاولات مراجعة المصادر. حاول بعد قليل.", 429);

  const { eventSlug } = await context.params;
  const access = await authorizeEventRequest(request, eventSlug, ["OWNER", "ADMIN", "EDITOR"]);
  if (!access.authorized) return errorResponse(access.userId ? "FORBIDDEN" : "UNAUTHORIZED", access.userId ? "صلاحية مراجعة الكتالوج مطلوبة." : "غير مصرح.", access.userId ? 403 : 401);
  if (!access.event) return errorResponse("EVENT_NOT_FOUND", "الفعالية غير موجودة.", 404);

  const body = await request.json().catch(() => ({}));
  const versionId = typeof body?.versionId === "string" ? body.versionId : "";
  const sourceId = typeof body?.sourceId === "string" ? body.sourceId : "";
  const reviewStatus = body?.reviewStatus === "VERIFIED" || body?.reviewStatus === "REJECTED" ? body.reviewStatus : null;
  if (!versionId || !sourceId || !reviewStatus) return errorResponse("INVALID_REQUEST", "versionId وsourceId وحالة المراجعة مطلوبة.", 400);

  const source = await prisma.contentSource.findFirst({
    where: { id: sourceId, catalogVersionId: versionId, catalogVersion: { eventId: access.event.id } },
    select: { id: true, title: true, catalogVersionId: true },
  });
  if (!source) return errorResponse("SOURCE_NOT_FOUND", "المصدر غير موجود في نسخة هذه الفعالية.", 404);

  const version = await prisma.catalogVersion.findFirst({ where: { id: versionId, eventId: access.event.id }, select: { id: true, status: true } });
  if (!version) return errorResponse("VERSION_NOT_FOUND", "نسخة الكتالوج غير موجودة.", 404);
  if (version.status !== "DRAFT" && version.status !== "REJECTED") return errorResponse("VERSION_LOCKED", "لا يمكن مراجعة مصدر داخل نسخة منشورة.", 409);

  const updated = await prisma.$transaction(async (tx) => {
    const updatedSource = await tx.contentSource.update({ where: { id: source.id }, data: { reviewStatus } });
    const itemStatus = reviewStatus === "VERIFIED" ? "VERIFIED" : "REJECTED";
    const [zones, activities] = await Promise.all([
      tx.zone.updateMany({ where: { catalogVersionId: version.id, sourceRefs: { has: source.id } }, data: { reviewStatus: itemStatus } }),
      tx.activity.updateMany({ where: { catalogVersionId: version.id, sourceRefs: { has: source.id } }, data: { reviewStatus: itemStatus } }),
    ]);
    await tx.catalogVersion.update({ where: { id: version.id }, data: { status: "DRAFT", validationReport: Prisma.JsonNull } });
    await tx.auditLog.create({
      data: {
        organizationId: access.event!.organizationId,
        actorUserId: access.userId ?? undefined,
        action: "catalog_source.review",
        entityType: "ContentSource",
        entityId: source.id,
        afterSummary: { versionId: version.id, reviewStatus, zonesUpdated: zones.count, activitiesUpdated: activities.count },
      },
    });
    return { updatedSource, zonesUpdated: zones.count, activitiesUpdated: activities.count };
  });

  return NextResponse.json({ data: { id: updated.updatedSource.id, title: updated.updatedSource.title, reviewStatus, zonesUpdated: updated.zonesUpdated, activitiesUpdated: updated.activitiesUpdated }, meta: { persistence: "postgresql" } });
});
