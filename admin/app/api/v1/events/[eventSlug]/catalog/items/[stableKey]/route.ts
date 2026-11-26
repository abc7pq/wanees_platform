import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { authorizeEventRequest } from "@/lib/catalog-auth";
import { enforceAdminRateLimit, isSameOrigin } from "@/lib/request-security";
import { withAdminApiContract } from "@/lib/api-response";
import { parseActivityTags } from "@wanees/engine/content-rules";
import { reviewTagSuggestions, suggestActivityTags } from "@/lib/activity-content";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string; stableKey: string }> };

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export const PATCH = withAdminApiContract(async function PATCH(request: Request, context: Context) {
  if (!isSameOrigin(request)) return errorResponse("FORBIDDEN", "تعذر التحقق من مصدر الطلب.", 403);
  const rate = await enforceAdminRateLimit(request, "catalog-activity", 90);
  if (!rate.allowed) return errorResponse("RATE_LIMITED", "انتظر قليلًا قبل حفظ نشاط آخر.", 429);
  const { eventSlug, stableKey } = await context.params;
  const access = await authorizeEventRequest(request, eventSlug, ["OWNER", "ADMIN", "EDITOR"]);
  if (!access.authorized) return errorResponse(access.userId ? "FORBIDDEN" : "UNAUTHORIZED", access.userId ? "صلاحية تحرير الكتالوج مطلوبة." : "غير مصرح.", access.userId ? 403 : 401);
  if (!access.event) return errorResponse("EVENT_NOT_FOUND", "الفعالية غير موجودة.", 404);
  const body = await request.json().catch(() => null);
  if (!isRecord(body) || typeof body.versionId !== "string") return errorResponse("INVALID_REQUEST", "versionId وبيانات النشاط مطلوبة.", 400);

  const version = await prisma.catalogVersion.findFirst({ where: { id: body.versionId, eventId: access.event.id }, select: { id: true, status: true } });
  if (!version) return errorResponse("VERSION_NOT_FOUND", "نسخة الكتالوج غير موجودة.", 404);
  if (version.status !== "DRAFT" && version.status !== "REJECTED") return errorResponse("VERSION_LOCKED", "لا يمكن تعديل نسخة منشورة.", 409);
  const source = typeof body.factsSource === "string" ? body.factsSource.trim() : "";
  if (source.length > 240) return errorResponse("INVALID_REQUEST", "اختصر مرجع الحقائق إلى 240 حرفًا.", 400);

  const data: Prisma.ActivityUpdateInput = {};
  if (typeof body.nameAr === "string" && body.nameAr.trim()) data.nameAr = body.nameAr.trim().slice(0, 240);
  if (typeof body.descriptionAr === "string") data.descriptionAr = body.descriptionAr.trim().slice(0, 2000);
  if (typeof body.descriptionEn === "string") data.descriptionEn = body.descriptionEn.trim().slice(0, 2000);
  if (body.tags !== undefined) {
    const parsedTags = parseActivityTags(body.tags);
    if (!parsedTags.ok) return errorResponse("INVALID_TAGS", parsedTags.unknown.length ? `وسوم خارج القائمة المعتمدة: ${parsedTags.unknown.join("، ")}.` : "الوسوم يجب أن تكون قائمة نصوص.", 400);
    data.tags = parsedTags.tags;
  }
  if (Array.isArray(body.highlightsAr) && body.highlightsAr.every((item) => typeof item === "string")) data.highlightsAr = body.highlightsAr.map((item) => item.trim().slice(0, 80)).filter(Boolean).slice(0, 5);
  const approveTags = Array.isArray(body.approveTags) ? body.approveTags.filter((item): item is string => typeof item === "string") : null;
  const rejectTags = Array.isArray(body.rejectTags) ? body.rejectTags.filter((item): item is string => typeof item === "string") : null;
  if (typeof body.durationMin === "number" && Number.isInteger(body.durationMin) && body.durationMin > 0 && body.durationMin <= 1440) data.durationMin = body.durationMin;
  for (const field of ["priceMinCents", "priceMaxCents"] as const) {
    const value = body[field];
    if (value === null || (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100_000_000)) data[field] = value;
  }
  if (body.ageMin === null || (typeof body.ageMin === "number" && Number.isInteger(body.ageMin) && body.ageMin >= 0 && body.ageMin <= 120)) data.ageMin = body.ageMin;
  if (typeof body.familyFriendly === "boolean") data.familyFriendly = body.familyFriendly;
  if (Array.isArray(body.interests) && body.interests.every((item) => typeof item === "string")) data.interests = body.interests.slice(0, 20).map((item) => item.trim()).filter(Boolean);
  if (Array.isArray(body.moods) && body.moods.every((item) => typeof item === "string")) data.moods = body.moods.slice(0, 20).map((item) => item.trim()).filter(Boolean);
  if (body.status === "ACTIVE" || body.status === "TEMPORARILY_CLOSED" || body.status === "EXPIRED") data.status = body.status;
  // Audit 3.4: the entrance is a walkway node of this version, checked against the activity below.
  if (body.entranceNodeKey === null || body.entranceNodeKey === "") data.entranceNodeKey = null;
  else if (typeof body.entranceNodeKey === "string") data.entranceNodeKey = body.entranceNodeKey.trim().slice(0, 120);
  const changesSchedule = body.scheduleStartsAt !== undefined || body.scheduleEndsAt !== undefined;
  const explicitOffset = /(?:Z|[+-]\d{2}:\d{2})$/;
  const startsAt = typeof body.scheduleStartsAt === "string" && explicitOffset.test(body.scheduleStartsAt) ? new Date(body.scheduleStartsAt) : null;
  const endsAt = typeof body.scheduleEndsAt === "string" && explicitOffset.test(body.scheduleEndsAt) ? new Date(body.scheduleEndsAt) : null;
  if (changesSchedule && (!startsAt || !endsAt || !Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt || endsAt.getTime() - startsAt.getTime() > 86400_000)) {
    return errorResponse("INVALID_SCHEDULE", "أدخل بداية ونهاية صالحتين ضمن دورة التشغيل.", 400);
  }
  const reviewsTags = Boolean(approveTags?.length || rejectTags?.length);
  if (!source && !changesSchedule && !reviewsTags && !Object.keys(data).length) return errorResponse("NO_CHANGES", "لم تصل أي تغييرات صالحة.", 400);

  const activity = await prisma.activity.findFirst({ where: { catalogVersionId: version.id, stableKey }, select: { id: true, stableKey: true, zoneId: true, entranceNodeKey: true } });
  if (!activity) return errorResponse("ACTIVITY_NOT_FOUND", "النشاط غير موجود في نسخة الكتالوج.", 404);
  if (typeof data.entranceNodeKey === "string" && data.entranceNodeKey !== activity.entranceNodeKey) {
    const node = await prisma.routeNode.findFirst({ where: { catalogVersionId: version.id, stableKey: data.entranceNodeKey }, select: { zoneId: true, status: true } });
    if (!node || node.zoneId !== activity.zoneId || node.status !== "open") return errorResponse("INVALID_ENTRANCE", "اختر مدخلًا مفتوحًا من مواقع نفس المنطقة.", 400);
  }
  const updated = await prisma.$transaction(async (tx) => {
    const locked = await tx.catalogVersion.updateMany({
      where: { id: version.id, eventId: access.event!.id, status: { in: ["DRAFT", "REJECTED"] } },
      data: { status: "DRAFT", validationReport: { valid: false, editRevision: randomUUID() } },
    });
    if (!locked.count) return null;
    const evidence = source ? await tx.contentSource.create({
      data: {
        catalogVersionId: version.id, sourceType: "operator_activity", title: `حقائق النشاط ${activity.stableKey}`,
        locator: source, observedAt: new Date(), reviewStatus: "VERIFIED", trustLevel: "operator_verified",
      },
    }) : null;
    const stored = await tx.activity.findUniqueOrThrow({ where: { id: activity.id } });
    // An organizer approves or rejects the suggested tags; nothing else moves a suggestion into `tags`.
    if (reviewsTags) {
      const reviewed = reviewTagSuggestions({ tags: (data.tags as string[] | undefined) ?? stored.tags, suggestions: stored.tagSuggestions }, approveTags ?? [], rejectTags ?? []);
      data.tags = reviewed.tags;
      data.tagSuggestions = reviewed.suggestions;
    } else if (data.descriptionAr !== undefined || data.nameAr !== undefined || data.tags !== undefined) {
      data.tagSuggestions = suggestActivityTags({
        nameAr: (data.nameAr as string | undefined) ?? stored.nameAr, nameEn: stored.nameEn,
        descriptionAr: (data.descriptionAr as string | undefined) ?? stored.descriptionAr, tags: (data.tags as string[] | undefined) ?? stored.tags,
      });
    }
    const affectsFacts = changesSchedule || (["durationMin", "priceMinCents", "priceMaxCents", "ageMin", "familyFriendly"] as const)
      .some((field) => field in data && data[field] !== stored[field]);
    const row = await tx.activity.update({
      where: { id: activity.id },
      data: {
        ...data,
        ...(evidence ? { reviewStatus: "VERIFIED", sourceRefs: { push: evidence.id } } : affectsFacts ? { reviewStatus: "UNREVIEWED" } : {}),
      },
    });
    if (changesSchedule && startsAt && endsAt) {
      await tx.schedule.deleteMany({ where: { activityId: row.id } });
      await tx.schedule.create({ data: { activityId: row.id, startsAt, endsAt, kind: "continuous", status: "active" } });
    }
    await tx.auditLog.create({
      data: {
        organizationId: access.event!.organizationId,
        actorUserId: access.userId ?? undefined,
        action: "catalog_activity.update",
        entityType: "Activity",
        entityId: row.id,
        afterSummary: { ...data, ...(evidence ? { sourceId: evidence.id } : {}), ...(changesSchedule ? { startsAt: startsAt?.toISOString(), endsAt: endsAt?.toISOString() } : {}) } as Prisma.InputJsonObject,
      },
    });
    return row;
  });
  if (!updated) return errorResponse("VERSION_LOCKED", "لا يمكن تعديل نسخة منشورة.", 409);
  return NextResponse.json({ data: { id: updated.id, stableKey: updated.stableKey, nameAr: updated.nameAr, durationMin: updated.durationMin, status: updated.status }, meta: { persistence: "postgresql", versionId: version.id } });
});
