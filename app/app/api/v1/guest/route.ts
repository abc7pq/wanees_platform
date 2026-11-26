import { prisma } from "@/lib/db";
import {
  clearGuestCookie,
  createGuestToken,
  GUEST_COOKIE,
  hashGuestToken,
  loadGuestProfile,
  readGuestToken,
  sanitizePreferencesSnapshot,
  setGuestCookie,
} from "@/lib/guest-session";
import { enforceRateLimit } from "@/lib/rate-limit";
import { jsonData, jsonError } from "@/lib/api-response";
import { z } from "zod";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  displayName: z.string().trim().max(40).nullable().optional(),
  preferences: z.unknown().optional(),
}).strict();

/** ملخص ملف الضيف للواجهة — لا يكشف التوكن ولا أي معرّف داخلي */
export async function GET(request: Request) {
  if (!process.env.DATABASE_URL) {
    return jsonError(request, "DATABASE_UNAVAILABLE", "ملف الضيف غير متاح في هذا التشغيل.", 503);
  }
  const found = await loadGuestProfile(request);
  const response = found
    ? jsonData(request, {
        exists: true as const,
        displayName: found.profile.displayName,
        preferences: found.profile.preferences ?? null,
        affinityTags: found.profile.affinityTags.slice(0, 12),
        visitedCount: found.profile.visitedKeys.length,
      })
    : jsonData(request, { exists: false as const });
  return response;
}

/** إنشاء ملف عند أول زيارة (يستدعيه مسار الجلسة غير مباشرة، ومتاح للتطبيقات الأصلية) */
export async function POST(request: Request) {
  const rate = await enforceRateLimit(request, { scope: `guest:${GUEST_COOKIE}`, limit: 30 });
  if (!rate.allowed) {
    return jsonError(request, "RATE_LIMITED", "محاولات كثيرة، حاول بعد قليل.", 429);
  }
  if (!process.env.DATABASE_URL) {
    return jsonError(request, "DATABASE_UNAVAILABLE", "ملف الضيف غير متاح في هذا التشغيل.", 503);
  }
  const existing = await loadGuestProfile(request);
  if (existing) {
    return jsonData(request, { exists: true as const });
  }
  const token = createGuestToken();
  await prisma.guestProfile.create({ data: { publicTokenHash: hashGuestToken(token) } });
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
  const found = await loadGuestProfile(request);
  if (!found) {
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

/** «حذف بياناتي»: يمسح ملف الضيف نهائيًا ويزيل الكوكي — الجلسات الحية تبقى سليمة */
export async function DELETE(request: Request) {
  const rate = await enforceRateLimit(request, { scope: `guest:${GUEST_COOKIE}`, limit: 30 });
  if (!rate.allowed) {
    return jsonError(request, "RATE_LIMITED", "محاولات كثيرة، حاول بعد قليل.", 429);
  }
  const token = readGuestToken(request);
  if (token && process.env.DATABASE_URL) {
    await prisma.guestProfile.deleteMany({ where: { publicTokenHash: hashGuestToken(token) } });
  }
  const response = jsonData(request, { deleted: true as const });
  clearGuestCookie(response);
  return response;
}
