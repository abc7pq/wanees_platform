import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeEventRequest } from "@/lib/catalog-auth";
import { enforceAdminRateLimit, isSameOrigin } from "@/lib/request-security";
import { withAdminApiContract } from "@/lib/api-response";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

// Kiosk screens (audit 5.2). An organizer registers a screen at one walkway node and gets its token
// once; only the SHA-256 hash is stored. The visitor app checks the same hash (app/lib/kiosk.ts).
const READERS = ["OWNER", "ADMIN", "OPERATOR"] as const;
const MANAGERS = ["OWNER", "ADMIN"] as const;

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function view(row: { id: string; name: string; nodeKey: string; revokedAt: Date | null; lastSeenAt: Date | null; createdAt: Date }) {
  return {
    id: row.id,
    name: row.name,
    nodeKey: row.nodeKey,
    status: row.revokedAt ? "revoked" : "active",
    revokedAt: row.revokedAt?.toISOString() ?? null,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export const GET = withAdminApiContract(async function GET(request: Request, context: Context) {
  if (!process.env.DATABASE_URL) return errorResponse("DATABASE_UNAVAILABLE", "قاعدة البيانات غير مفعلة.", 503);
  const { eventSlug } = await context.params;
  const access = await authorizeEventRequest(request, eventSlug, [...READERS]);
  if (!access.authorized) return errorResponse(access.userId ? "FORBIDDEN" : "UNAUTHORIZED", "صلاحية المشغّل مطلوبة لعرض الشاشات.", access.userId ? 403 : 401);
  if (!access.event) return errorResponse("EVENT_NOT_FOUND", "الفعالية غير موجودة ضمن المنظمة الحالية.", 404);
  const rows = await prisma.kioskDevice.findMany({ where: { eventId: access.event.id }, orderBy: [{ createdAt: "desc" }, { id: "asc" }] });
  return NextResponse.json({ data: rows.map(view), meta: { persistence: "postgresql", count: rows.length } });
});

export const POST = withAdminApiContract(async function POST(request: Request, context: Context) {
  if (!isSameOrigin(request)) return errorResponse("FORBIDDEN", "الطلب غير صادر من مصدر موثوق.", 403);
  const rate = await enforceAdminRateLimit(request, "kiosk", 20);
  if (!rate.allowed) {
    const response = errorResponse("RATE_LIMITED", "طلبات كثيرة. حاول بعد قليل.", 429);
    response.headers.set("retry-after", String(rate.retryAfterSeconds));
    return response;
  }
  if (!process.env.DATABASE_URL) return errorResponse("DATABASE_UNAVAILABLE", "قاعدة البيانات غير مفعلة.", 503);
  const { eventSlug } = await context.params;
  const access = await authorizeEventRequest(request, eventSlug, [...MANAGERS]);
  if (!access.authorized) return errorResponse(access.userId ? "FORBIDDEN" : "UNAUTHORIZED", "إضافة شاشة تحتاج صلاحية مالك أو مدير.", access.userId ? 403 : 401);
  if (!access.event) return errorResponse("EVENT_NOT_FOUND", "الفعالية غير موجودة ضمن المنظمة الحالية.", 404);
  if (!access.event.publishedCatalogVersionId) return errorResponse("CATALOG_UNAVAILABLE", "انشر الكتالوج قبل إضافة شاشة.", 409);

  const body = await request.json().catch(() => null) as { name?: unknown; nodeKey?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const nodeKey = typeof body?.nodeKey === "string" ? body.nodeKey.trim() : "";
  if (!name || name.length > 80 || !nodeKey || nodeKey.length > 120) return errorResponse("INVALID_REQUEST", "اسم الشاشة (حتى 80 حرفًا) ونقطتها على الممرات مطلوبان.", 400);
  const node = await prisma.routeNode.findFirst({
    where: { catalogVersionId: access.event.publishedCatalogVersionId, stableKey: nodeKey },
    select: { status: true },
  });
  if (!node || node.status !== "open") return errorResponse("INVALID_NODE", "اختر نقطة مفتوحة من ممرات الكتالوج المنشور.", 400);

  const token = `wk_${randomBytes(32).toString("base64url")}`;
  const created = await prisma.$transaction(async (tx) => {
    const kiosk = await tx.kioskDevice.create({
      data: {
        organizationId: access.event!.organizationId,
        eventId: access.event!.id,
        name,
        nodeKey,
        tokenHash: createHash("sha256").update(token, "utf8").digest("hex"),
        createdByUserId: access.userId ?? undefined,
      },
    });
    await tx.auditLog.create({ data: { organizationId: access.event!.organizationId, actorUserId: access.userId ?? undefined, action: "kiosk.create", entityType: "KioskDevice", entityId: kiosk.id, afterSummary: { name, nodeKey } } });
    return kiosk;
  });
  // The token is shown once. It goes into the screen's address as #kiosk=…, never in a query string.
  const response = NextResponse.json({ data: { ...view(created), token }, meta: { persistence: "postgresql" } }, { status: 201 });
  response.headers.set("cache-control", "no-store");
  return response;
});
