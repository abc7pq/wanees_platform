import { prisma } from "@/lib/db";
import {
  createGuestToken,
  deleteGuestProfiles,
  findGuestProfile,
  GUEST_COOKIE,
  hashGuestToken,
  readGuestToken,
  sanitizePreferencesSnapshot,
  setGuestCookie,
  clearGuestCookie,
} from "@/lib/guest-session";
import { resolveEventScope } from "@/lib/visitor-store";
import { enforceRateLimit } from "@/lib/rate-limit";
import { jsonData, jsonError } from "@/lib/api-response";
import { z } from "zod";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  displayName: z.string().trim().max(40).nullable().optional(),
  preferences: z.unknown().optional(),
}).strict();

const eventSlugSchema = z.string().trim().min(1).max(120).regex(/^[a-z0-9-]+$/);

/**
 * Guest profiles belong to one organization. `?eventSlug=` names the event (and so the
 * organization); without it the request only works when this browser has a single profile.
 */
async function requestScope(request: Request): Promise<{ organizationId: string | null } | Response> {
  const raw = new URL(request.url).searchParams.get("eventSlug");
  if (raw === null) return { organizationId: null };
  const slug = eventSlugSchema.safeParse(raw);
  if (!slug.success) return jsonError(request, "INVALID_REQUEST", "معرف الفعالية غير صالح.", 400);
  const scope = await resolveEventScope(slug.data);
  if (!scope) return jsonError(request, "EVENT_UNAVAILABLE", "الفعالية غير متاحة حاليًا.", 404);
  return { organizationId: scope.organizationId };
}

function ambiguous(request: Request) {
  return jsonError(request, "GUEST_PROFILE_AMBIGUOUS", "لهذا المتصفح ملفات عند أكثر من جهة منظمة. حدّد الفعالية.", 409);
}

/** ملخص ملف الضيف للواجهة — لا يكشف التوكن ولا أي معرّف داخلي */
export async function GET(request: Request) {
  if (!process.env.DATABASE_URL) {
    return jsonError(request, "DATABASE_UNAVAILABLE", "ملف الضيف غير متاح في هذا التشغيل.", 503);
  }
  const scope = await requestScope(request);
  if (scope instanceof Response) return scope;
  const found = await findGuestProfile(request, scope.organizationId);
  if (found.status === "ambiguous") return ambiguous(request);
  return found.status === "found"
    ? jsonData(request, {
        exists: true as const,
        displayName: found.profile.displayName,
        preferences: found.profile.preferences ?? null,
        affinityTags: found.profile.affinityTags.slice(0, 12),
        visitedCount: found.profile.visitedKeys.length,
        visitCount: found.profile.visitCount,
        lastVisitAt: found.profile.lastVisitAt?.toISOString() ?? null,
      })
    : jsonData(request, { exists: false as const });
}

/** إنشاء ملف لفعالية محددة (يستدعيه مسار الجلسة غير مباشرة، ومتاح للتطبيقات الأصلية) */
export async function POST(request: Request) {
  const rate = await enforceRateLimit(request, { scope: `guest:${GUEST_COOKIE}`, limit: 30 });
  if (!rate.allowed) {
    return jsonError(request, "RATE_LIMITED", "محاولات كثيرة، حاول بعد قليل.", 429);
  }
  if (!process.env.DATABASE_URL) {
    return jsonError(request, "DATABASE_UNAVAILABLE", "ملف الضيف غير متاح في هذا التشغيل.", 503);
  }
  const scope = await requestScope(request);
  if (scope instanceof Response) return scope;
  if (!scope.organizationId) {
    return jsonError(request, "INVALID_REQUEST", "حدّد الفعالية بالمعامل eventSlug.", 400);
  }
  const existing = await findGuestProfile(request, scope.organizationId);
  if (existing.status === "found") {
    return jsonData(request, { exists: true as const });
  }
  // Reuse this browser's token so a visitor keeps one cookie across organizations; each
  // organization still gets its own, unrelated profile row.
  const token = readGuestToken(request) ?? createGuestToken();
  await prisma.guestProfile.upsert({
    where: { organizationId_publicTokenHash: { organizationId: scope.organizationId, publicTokenHash: hashGuestToken(token) } },
    create: { organizationId: scope.organizationId, publicTokenHash: hashGuestToken(token) },
    update: { deletedAt: null },
  });
  const response = jsonData(request, { exists: true as const }, undefined, { status: 201 });
  setGuestCookie(response, token);
  return response;
}

/** تحديث اسم العرض أو لقطة التفضيلات يدويًا */
export async function PATCH(request: Request) {
  const rate = await enforceRateLimit(request, { scope: `guest:${GUEST_COOKIE}`, limit: 30 });
  if (!rate.allowed) {
    return jsonError(request, "RATE_LIMITED", "محاولات كثيرة، حاول بعد قليل.", 429);
  }
  if (!process.env.DATABASE_URL) {
    return jsonError(request, "DATABASE_UNAVAILABLE", "ملف الضيف غير متاح في هذا التشغيل.", 503);
  }
  const scope = await requestScope(request);
  if (scope instanceof Response) return scope;
  const found = await findGuestProfile(request, scope.organizationId);
  if (found.status === "ambiguous") return ambiguous(request);
  if (found.status === "missing") {
    return jsonError(request, "GUEST_PROFILE_NOT_FOUND", "لا يوجد ملف ضيف لهذا المتصفح.", 404);
  }
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError(request, "INVALID_REQUEST", "بيانات التحديث غير صالحة.", 400, parsed.error.flatten());
  }
  const data: Record<string, unknown> = {};
  if (parsed.data.displayName !== undefined) data.displayName = parsed.data.displayName || null;
  if (parsed.data.preferences !== undefined) {
    const snapshot = sanitizePreferencesSnapshot(parsed.data.preferences);
    if (snapshot) data.preferences = snapshot;
  }
  if (Object.keys(data).length) {
    await prisma.guestProfile.update({ where: { id: found.profile.id }, data: data as any });
  }
  return jsonData(request, { updated: true as const });
}

/** «حذف بياناتي»: يمسح كل ملفات هذا المتصفح عند كل الجهات ويزيل الكوكي — الجلسات الحية تبقى سليمة */
export async function DELETE(request: Request) {
  const rate = await enforceRateLimit(request, { scope: `guest:${GUEST_COOKIE}`, limit: 30 });
  if (!rate.allowed) {
    return jsonError(request, "RATE_LIMITED", "محاولات كثيرة، حاول بعد قليل.", 429);
  }
  const token = readGuestToken(request);
  if (token && process.env.DATABASE_URL) {
    await deleteGuestProfiles(token);
  }
  const response = jsonData(request, { deleted: true as const });
  clearGuestCookie(response);
  return response;
}
