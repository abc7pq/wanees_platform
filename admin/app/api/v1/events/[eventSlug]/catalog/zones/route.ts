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
  const rate = await enforceAdminRateLimit(request, "catalog-zone", 90);
  if (!rate.allowed) return errorResponse("RATE_LIMITED", "انتظر قليلًا قبل حفظ منطقة أخرى.", 429);
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
  const nameAr = typeof body?.nameAr === "string" ? body.nameAr.trim().slice(0, 160) : "";
  if (!nameAr) return errorResponse("INVALID_REQUEST", "اسم المنطقة مطلوب.", 400);
  const key = stableKey(body?.stableKey, `zone-${Date.now()}`);
  const mapX = typeof body?.mapX === "number" ? body.mapX : 0;
  const mapY = typeof body?.mapY === "number" ? body.mapY : 0;
  try {
    const zone = await prisma.$transaction(async (tx) => {
      // Any edit invalidates the last validation report so publish needs a fresh check.
      const locked = await tx.catalogVersion.updateMany({
        where: { id: version.id, eventId: access.event!.id, status: { in: ["DRAFT", "REJECTED"] } },
        data: { status: "DRAFT", validationReport: { valid: false, editRevision: randomUUID() } },
      });
      if (!locked.count) return null;
      const created = await tx.zone.create({
        data: {
          catalogVersionId: version.id,
          stableKey: key,
          nameAr,
          nameEn: typeof body?.nameEn === "string" ? body.nameEn.trim().slice(0, 160) : undefined,
          description: typeof body?.description === "string" ? body.description.trim().slice(0, 1000) : undefined,
          mapX,
          mapY,
          capacity: typeof body?.capacity === "number" && Number.isInteger(body.capacity) && body.capacity > 0 ? body.capacity : undefined,
          tags: Array.isArray(body?.tags) ? body.tags.filter((item: unknown): item is string => typeof item === "string").slice(0, 20) : [],
          popularityWeight: typeof body?.popularityWeight === "number" ? Math.max(0, Math.min(1, body.popularityWeight)) : 0.5,
        },
      });
      await tx.auditLog.create({ data: { organizationId: access.event!.organizationId, actorUserId: access.userId ?? undefined, action: "catalog_zone.create", entityType: "Zone", entityId: created.id, afterSummary: { stableKey: key, versionId: version.id } } });
      return created;
    });
    if (!zone) return errorResponse("VERSION_LOCKED", "لا يمكن تعديل نسخة منشورة.", 409);
    return NextResponse.json({ data: { id: zone.id, stableKey: zone.stableKey, nameAr: zone.nameAr, versionId: version.id }, meta: { persistence: "postgresql" } }, { status: 201 });
  } catch {
    return errorResponse("ZONE_CREATE_FAILED", "تعذر إنشاء المنطقة؛ تأكد من أن المعرف غير مستخدم.", 409);
  }
});

export const PATCH = withAdminApiContract(async function PATCH(request: Request, context: Context) {
  if (!isSameOrigin(request)) return errorResponse("FORBIDDEN", "تعذر التحقق من مصدر الطلب.", 403);
  const rate = await enforceAdminRateLimit(request, "catalog-capacity", 90);
  if (!rate.allowed) return errorResponse("RATE_LIMITED", "انتظر قليلًا قبل حفظ سعة جديدة.", 429);
  const { eventSlug } = await context.params;
  const access = await authorizeEventRequest(request, eventSlug, ["OWNER", "ADMIN"]);
  if (!access.authorized) return errorResponse(access.userId ? "FORBIDDEN" : "UNAUTHORIZED", "يتطلب اعتماد السعة صلاحية إدارة الفعالية.", access.userId ? 403 : 401);
  if (!access.event) return errorResponse("EVENT_NOT_FOUND", "الفعالية غير موجودة.", 404);

  const body = await request.json().catch(() => null);
  const versionId = typeof body?.versionId === "string" ? body.versionId : "";
  const zoneKey = typeof body?.zoneKey === "string" ? body.zoneKey : "";
  const capacity = body?.capacity;
  const locator = typeof body?.source === "string" ? body.source.trim() : "";
  if (!versionId || !zoneKey || !Number.isInteger(capacity) || capacity < 1 || capacity > 1_000_000 || !locator || locator.length > 240) {
    return errorResponse("INVALID_REQUEST", "اختر منطقة وأدخل السعة ومصدر اعتمادها.", 400);
  }
  const { id: eventId, organizationId } = access.event;
  const result = await prisma.$transaction(async (tx) => {
    const draft = await tx.catalogVersion.updateMany({
      where: { id: versionId, eventId, status: "DRAFT" },
      data: { validationReport: { valid: false, editRevision: randomUUID() } },
    });
    if (!draft.count) return "DRAFT";
    const zone = await tx.zone.findUnique({
      where: { catalogVersionId_stableKey: { catalogVersionId: versionId, stableKey: zoneKey } },
      select: { id: true, nameAr: true, capacity: true, sourceRefs: true },
    });
    if (!zone) return "ZONE";
    const source = await tx.contentSource.create({
      data: {
        catalogVersionId: versionId, sourceType: "operator_capacity", title: `اعتماد سعة ${zone.nameAr}`,
        locator, observedAt: new Date(), reviewStatus: "VERIFIED", trustLevel: "operator_verified",
      },
      select: { id: true },
    });
    await tx.zone.update({
      where: { id: zone.id },
      data: { capacity, sourceRefs: { push: source.id }, ...(zone.sourceRefs.length ? {} : { reviewStatus: "VERIFIED" }) },
    });
    await tx.auditLog.create({ data: {
      organizationId, actorUserId: access.userId ?? undefined, action: "catalog_zone.capacity",
      entityType: "Zone", entityId: zone.id, beforeSummary: { capacity: zone.capacity },
      afterSummary: { capacity, sourceId: source.id },
    } });
    return "OK";
  });
  if (result === "DRAFT") return errorResponse("VERSION_LOCKED", "اعتماد السعة متاح في مسودة فقط.", 409);
  if (result === "ZONE") return errorResponse("TARGET_NOT_FOUND", "المنطقة غير موجودة في المسودة.", 404);
  return NextResponse.json({ data: { versionId, zoneKey, capacity } });
});
