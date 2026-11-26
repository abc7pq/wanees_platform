import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { authorizeEventRequest } from "@/lib/catalog-auth";
import { enforceAdminRateLimit, isSameOrigin } from "@/lib/request-security";
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

function riyadhMinute(minute: number) {
  const date = new Date(Date.UTC(2026, 10, 20, 0, 0, 0));
  date.setUTCMinutes(minute - 180);
  return date;
}

export const POST = withAdminApiContract(async function POST(request: Request, context: Context) {
  if (!isSameOrigin(request)) return errorResponse("FORBIDDEN", "تعذر التحقق من مصدر الطلب.", 403);
  const rate = await enforceAdminRateLimit(request, "catalog-activity", 90);
  if (!rate.allowed) return errorResponse("RATE_LIMITED", "انتظر قليلًا قبل حفظ نشاط آخر.", 429);
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
  const nameAr = typeof body?.nameAr === "string" ? body.nameAr.trim().slice(0, 240) : "";
  const zoneStableKey = typeof body?.zoneStableKey === "string" ? body.zoneStableKey.trim() : "";
  if (!nameAr || !zoneStableKey) return errorResponse("INVALID_REQUEST", "اسم النشاط والمنطقة مطلوبان.", 400);
  const zone = await prisma.zone.findFirst({ where: { catalogVersionId: version.id, stableKey: zoneStableKey }, select: { id: true } });
  if (!zone) return errorResponse("ZONE_NOT_FOUND", "المنطقة غير موجودة في هذه المسودة.", 404);
  const key = stableKey(body?.stableKey, `activity-${Date.now()}`);
  const durationMin = typeof body?.durationMin === "number" && Number.isInteger(body.durationMin) ? body.durationMin : 30;
  const price = typeof body?.priceSar === "number" && Number.isFinite(body.priceSar) ? Math.round(body.priceSar * 100) : null;
  const source = typeof body?.factsSource === "string" ? body.factsSource.trim() : "";
  if (source.length > 240 || (price !== null && (price < 0 || price > 100_000_000))) {
    return errorResponse("INVALID_REQUEST", "السعر أو مرجع الحقائق غير صالح.", 400);
  }
  const fromMin = typeof body?.scheduleFromMin === "number" ? Math.max(0, Math.min(1439, Math.round(body.scheduleFromMin))) : 1020;
  const toMin = typeof body?.scheduleToMin === "number" ? Math.max(fromMin + durationMin, Math.min(1440, Math.round(body.scheduleToMin))) : Math.min(1440, fromMin + Math.max(durationMin, 60));
  if (durationMin <= 0 || durationMin > 1440 || toMin <= fromMin) return errorResponse("INVALID_SCHEDULE", "مدة النشاط أو جدوله غير صالح.", 400);
  try {
    const created = await prisma.$transaction(async (tx) => {
      const locked = await tx.catalogVersion.updateMany({
        where: { id: version.id, eventId: access.event!.id, status: { in: ["DRAFT", "REJECTED"] } },
        data: { status: "DRAFT", validationReport: { valid: false, editRevision: randomUUID() } },
      });
      if (!locked.count) return null;
      const evidence = source ? await tx.contentSource.create({
        data: {
          catalogVersionId: version.id, sourceType: "operator_activity", title: `حقائق النشاط ${key}`,
          locator: source, observedAt: new Date(), reviewStatus: "VERIFIED", trustLevel: "operator_verified",
        },
      }) : null;
      const activity = await tx.activity.create({
        data: {
          catalogVersionId: version.id,
          zoneId: zone.id,
          stableKey: key,
          nameAr,
          nameEn: typeof body?.nameEn === "string" ? body.nameEn.trim().slice(0, 240) : undefined,
          descriptionAr: typeof body?.descriptionAr === "string" ? body.descriptionAr.trim().slice(0, 2000) : undefined,
          type: typeof body?.type === "string" ? body.type.trim().slice(0, 64) : "experience",
          durationMin,
          priceMinCents: price,
          priceMaxCents: price,
          ageMin: typeof body?.ageMin === "number" ? body.ageMin : undefined,
          ageMax: typeof body?.ageMax === "number" ? body.ageMax : undefined,
          familyFriendly: body?.familyFriendly === true,
          walkingLevel: typeof body?.walkingLevel === "string" ? body.walkingLevel.slice(0, 32) : "medium",
          interests: Array.isArray(body?.interests) ? body.interests.filter((item: unknown): item is string => typeof item === "string").slice(0, 20) : [],
          moods: Array.isArray(body?.moods) ? body.moods.filter((item: unknown): item is string => typeof item === "string").slice(0, 20) : [],
          popularityWeight: typeof body?.popularityWeight === "number" ? Math.max(0, Math.min(1, body.popularityWeight)) : 0.5,
          ...(evidence ? { reviewStatus: "VERIFIED", sourceRefs: [evidence.id] } : {}),
        },
      });
      await tx.schedule.create({ data: { activityId: activity.id, eventDate: new Date(Date.UTC(2026, 10, 20)), startsAt: riyadhMinute(fromMin), endsAt: riyadhMinute(toMin), kind: "continuous", status: "active" } });
      await tx.auditLog.create({ data: { organizationId: access.event!.organizationId, actorUserId: access.userId ?? undefined, action: "catalog_activity.create", entityType: "Activity", entityId: activity.id, afterSummary: { stableKey: key, versionId: version.id } } });
      return activity;
    });
    if (!created) return errorResponse("VERSION_LOCKED", "لا يمكن تعديل نسخة منشورة.", 409);
    return NextResponse.json({ data: { id: created.id, stableKey: created.stableKey, nameAr: created.nameAr, versionId: version.id }, meta: { persistence: "postgresql" } }, { status: 201 });
  } catch {
    return errorResponse("ACTIVITY_CREATE_FAILED", "تعذر إنشاء النشاط؛ تأكد من أن المعرف غير مستخدم.", 409);
  }
});
