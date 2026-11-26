import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeOrganizationRequest } from "@/lib/catalog-auth";
import { withAdminApiContract } from "@/lib/api-response";
import { enforceAdminRateLimit, isSameOrigin, isSameOriginRead } from "@/lib/request-security";
import { canSeeVisitorPii, maskPhone, VISITOR_PII_ROLES, wantsPhoneReveal } from "@/lib/visitor-access";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ visitorId: string }> };

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

async function authorize(request: Request) {
  const access = await authorizeOrganizationRequest(request, [...VISITOR_PII_ROLES]);
  if (access.authorized) return { access, failure: null };
  return {
    access,
    failure: errorResponse(access.userId ? "FORBIDDEN" : "UNAUTHORIZED", access.userId ? "عرض بيانات الزوار للمالك والمدير فقط." : "غير مصرح.", access.userId ? 403 : 401),
  };
}

export const GET = withAdminApiContract(async function GET(request: Request, context: Context) {
  const { visitorId } = await context.params;
  const { access, failure } = await authorize(request);
  if (failure || !access.organizationId) return failure!;
  const rate = await enforceAdminRateLimit(request, "visitors:view", 120);
  if (!rate.allowed) return errorResponse("RATE_LIMITED", "طلبات كثيرة. حاول بعد قليل.", 429);
  // The phone number is masked unless an Owner/Admin explicitly reveals it; the reveal is audited.
  const reveal = wantsPhoneReveal(request);
  if (reveal && !canSeeVisitorPii(access.role)) return errorResponse("FORBIDDEN", "إظهار رقم الجوال للمالك والمدير فقط.", 403);
  if (reveal && !isSameOriginRead(request)) return errorResponse("FORBIDDEN", "تعذر التحقق من مصدر الطلب.", 403);
  const visitor = await prisma.visitor.findFirst({
    where: { id: visitorId, organizationId: access.organizationId },
    select: {
      id: true, name: true, phoneE164: true, createdAt: true, lastSeenAt: true, consentVersion: true, consentedAt: true,
      visits: {
        orderBy: { startedAt: "desc" },
        take: 200,
        select: { id: true, startedAt: true, lastSeenAt: true, rating: true, companions: true, partySize: true, itineraryActivityKeys: true, event: { select: { slug: true, name: true } } },
      },
    },
  });
  if (!visitor) return errorResponse("VISITOR_NOT_FOUND", "الزائر غير موجود.", 404);
  await prisma.auditLog.create({
    data: { organizationId: access.organizationId, actorUserId: access.userId, action: reveal ? "visitor.reveal_phone" : "visitor.view", entityType: "Visitor", entityId: visitor.id, afterSummary: { visitCount: visitor.visits.length, phoneRevealed: reveal } },
  });
  return NextResponse.json({
    data: {
      ...visitor,
      phone: reveal ? visitor.phoneE164 : maskPhone(visitor.phoneE164),
      phoneMasked: !reveal,
      phoneE164: undefined,
      createdAt: visitor.createdAt.toISOString(),
      lastSeenAt: visitor.lastSeenAt.toISOString(),
      consentedAt: visitor.consentedAt.toISOString(),
      visits: visitor.visits.map((visit) => ({ ...visit, startedAt: visit.startedAt.toISOString(), lastSeenAt: visit.lastSeenAt.toISOString() })),
    },
  }, { headers: { "cache-control": "no-store" } });
});

export const DELETE = withAdminApiContract(async function DELETE(request: Request, context: Context) {
  if (!isSameOrigin(request)) return errorResponse("FORBIDDEN", "cross-origin request blocked", 403);
  const { visitorId } = await context.params;
  const { access, failure } = await authorize(request);
  if (failure || !access.organizationId) return failure!;
  const rate = await enforceAdminRateLimit(request, "visitors:delete", 30);
  if (!rate.allowed) return errorResponse("RATE_LIMITED", "طلبات كثيرة. حاول بعد قليل.", 429);
  const deleted = await prisma.$transaction(async (tx) => {
    const result = await tx.visitor.deleteMany({ where: { id: visitorId, organizationId: access.organizationId! } });
    if (result.count) {
      await tx.auditLog.create({
        data: { organizationId: access.organizationId!, actorUserId: access.userId, action: "visitor.delete", entityType: "Visitor", entityId: visitorId, afterSummary: { deleted: true } },
      });
    }
    return result.count;
  });
  if (!deleted) return errorResponse("VISITOR_NOT_FOUND", "الزائر غير موجود.", 404);
  return NextResponse.json({ data: { deleted: true } });
});
