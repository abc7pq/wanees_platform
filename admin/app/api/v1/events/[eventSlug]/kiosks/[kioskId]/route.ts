import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeEventRequest } from "@/lib/catalog-auth";
import { enforceAdminRateLimit, isSameOrigin } from "@/lib/request-security";
import { withAdminApiContract } from "@/lib/api-response";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string; kioskId: string }> };

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Revoke a screen: its token stops working and its open visit ends at the next request. */
export const DELETE = withAdminApiContract(async function DELETE(request: Request, context: Context) {
  if (!isSameOrigin(request)) return errorResponse("FORBIDDEN", "الطلب غير صادر من مصدر موثوق.", 403);
  const rate = await enforceAdminRateLimit(request, "kiosk", 20);
  if (!rate.allowed) {
    const response = errorResponse("RATE_LIMITED", "طلبات كثيرة. حاول بعد قليل.", 429);
    response.headers.set("retry-after", String(rate.retryAfterSeconds));
    return response;
  }
  if (!process.env.DATABASE_URL) return errorResponse("DATABASE_UNAVAILABLE", "قاعدة البيانات غير مفعلة.", 503);
  const { eventSlug, kioskId } = await context.params;
  const access = await authorizeEventRequest(request, eventSlug, ["OWNER", "ADMIN"]);
  if (!access.authorized) return errorResponse(access.userId ? "FORBIDDEN" : "UNAUTHORIZED", "إيقاف شاشة يحتاج صلاحية مالك أو مدير.", access.userId ? 403 : 401);
  if (!access.event) return errorResponse("EVENT_NOT_FOUND", "الفعالية غير موجودة ضمن المنظمة الحالية.", 404);
  const kiosk = await prisma.kioskDevice.findFirst({ where: { id: kioskId.slice(0, 64), eventId: access.event.id }, select: { id: true, revokedAt: true } });
  if (!kiosk) return errorResponse("NOT_FOUND", "الشاشة غير موجودة في هذه الفعالية.", 404);
  if (!kiosk.revokedAt) {
    const now = new Date();
    await prisma.$transaction([
      prisma.kioskDevice.update({ where: { id: kiosk.id }, data: { revokedAt: now } }),
      prisma.visitorSession.updateMany({ where: { kioskDeviceId: kiosk.id, deletedAt: null }, data: { deletedAt: now } }),
      prisma.auditLog.create({ data: { organizationId: access.event.organizationId, actorUserId: access.userId ?? undefined, action: "kiosk.revoke", entityType: "KioskDevice", entityId: kiosk.id } }),
    ]);
  }
  return NextResponse.json({ data: { id: kiosk.id, status: "revoked" }, meta: { persistence: "postgresql" } });
});
