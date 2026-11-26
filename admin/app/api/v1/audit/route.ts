import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeOrganizationRequest } from "@/lib/catalog-auth";
import { withAdminApiContract } from "@/lib/api-response";
import { enforceAdminRateLimit, isSameOriginRead } from "@/lib/request-security";
import { AUDIT_READER_ROLES } from "@/lib/member-rules";
import { auditCursorWhere, encodeAuditCursor, parseAuditQuery, safeAuditSummary, shortEntityId } from "@/lib/audit-view";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: NO_STORE });
}

/**
 * The organization audit history, newest first, keyset-paginated with ?cursor=.
 * Optional exact filters: ?action=&entityType=. Summaries are reduced to a safe view.
 */
export const GET = withAdminApiContract(async function GET(request: Request) {
  const access = await authorizeOrganizationRequest(request, [...AUDIT_READER_ROLES]);
  if (!access.authorized) {
    return errorResponse(access.userId ? "FORBIDDEN" : "UNAUTHORIZED", access.userId ? "سجل التدقيق للمالك والمدير فقط." : "غير مصرح.", access.userId ? 403 : 401);
  }
  if (!isSameOriginRead(request)) return errorResponse("FORBIDDEN", "تعذر التحقق من مصدر الطلب.", 403);
  const rate = await enforceAdminRateLimit(request, "audit:list", 60);
  if (!rate.allowed) return errorResponse("RATE_LIMITED", "طلبات كثيرة. حاول بعد قليل.", 429);
  const parsed = parseAuditQuery(new URL(request.url).searchParams);
  if (!parsed.ok) return errorResponse("INVALID_REQUEST", parsed.message, 400);
  const { action, entityType, cursor, limit } = parsed.value;
  const organizationId = access.organizationId;

  const scope = { organizationId, ...(action ? { action } : {}), ...(entityType ? { entityType } : {}) };
  const rows = await prisma.auditLog.findMany({
    where: { ...scope, ...auditCursorWhere(cursor) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: {
      id: true, action: true, entityType: true, entityId: true, beforeSummary: true, afterSummary: true, requestId: true, createdAt: true,
      actorUser: { select: { displayName: true } },
    },
  });
  const page = rows.slice(0, limit);
  const nextCursor = rows.length > limit && page.length ? encodeAuditCursor(page[page.length - 1]) : null;

  // Filter choices come from this organization's own history, on the first page only.
  const facets = cursor ? null : await Promise.all([
    prisma.auditLog.groupBy({ by: ["action"], where: { organizationId }, orderBy: { action: "asc" } }),
    prisma.auditLog.groupBy({ by: ["entityType"], where: { organizationId }, orderBy: { entityType: "asc" } }),
  ]).then(([actions, entityTypes]) => ({ actions: actions.map((row) => row.action), entityTypes: entityTypes.map((row) => row.entityType) }));

  return NextResponse.json({
    data: {
      entries: page.map((row) => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        action: row.action,
        entityType: row.entityType,
        entityId: shortEntityId(row.entityId),
        actor: row.actorUser ? { displayName: row.actorUser.displayName } : null,
        before: safeAuditSummary(row.beforeSummary, row.entityType),
        after: safeAuditSummary(row.afterSummary, row.entityType),
        requestId: row.requestId,
      })),
      nextCursor,
      facets,
    },
  }, { headers: NO_STORE });
});
