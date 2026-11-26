// هوية الضيف المجهولة — كوكي طويل الأمد بلا أي بيانات شخصية.
// نفس قواعد جلسة الزائر: التوكن عشوائي، يُخزن hashed فقط، والكوكي HttpOnly.
// القاعدة: الحفظ الطويل للتفضيلات يحدث فقط لعميل ويب، والحذف متاح بضغطة زر.
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./db.ts";

export const GUEST_COOKIE = "wanees_guest";
export const GUEST_TTL_SECONDS = 365 * 24 * 60 * 60;

export function createGuestToken() {
  return randomBytes(32).toString("base64url");
}

export function hashGuestToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function readGuestToken(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${GUEST_COOKIE}=([^;]+)`));
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function setGuestCookie(response: Response, token: string) {
  response.headers.append(
    "Set-Cookie",
    `${GUEST_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${GUEST_TTL_SECONDS}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
  );
  return response;
}

export function clearGuestCookie(response: Response) {
  response.headers.append(
    "Set-Cookie",
    `${GUEST_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
  );
  return response;
}

export type GuestProfileRecord = {
  id: string;
  displayName: string | null;
  preferences: unknown;
  affinityTags: string[];
  visitedKeys: string[];
};

/** يجد ملف الضيف من الكوكي، أو null إن لم يوجد/حُذف */
export async function loadGuestProfile(request: Request): Promise<{ token: string; profile: GuestProfileRecord } | null> {
  const token = readGuestToken(request);
  if (!token) return null;
  const profile = await prisma.guestProfile.findFirst({
    where: { publicTokenHash: hashGuestToken(token), deletedAt: null },
    select: { id: true, displayName: true, preferences: true, affinityTags: true, visitedKeys: true },
  });
  if (!profile) return null;
  return { token, profile };
}

export type GuestPreferencesSnapshot = {
  companions?: string;
  partySize?: number;
  youngestChildAge?: number;
  mood?: string;
  interests?: string[];
  budgetMaxCents?: number | null;
  availableMinutes?: number | null;
  startPointId?: string;
};

const PREFERENCE_KEYS = ["companions", "partySize", "youngestChildAge", "mood", "interests", "budgetMaxCents", "availableMinutes", "startPointId"] as const;

/** ينظف لقطة التفضيلات إلى الحقول المعروفة فقط بحدود آمنة */
export function sanitizePreferencesSnapshot(raw: unknown): GuestPreferencesSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const out: GuestPreferencesSnapshot = {};
  if (typeof source.companions === "string" && source.companions.trim()) out.companions = source.companions.slice(0, 40);
  if (typeof source.partySize === "number" && Number.isFinite(source.partySize)) {
    out.partySize = Math.max(1, Math.min(20, Math.round(source.partySize)));
  }
  if (typeof source.youngestChildAge === "number" && Number.isFinite(source.youngestChildAge)) {
    out.youngestChildAge = Math.max(0, Math.min(17, Math.round(source.youngestChildAge)));
  }
  if (typeof source.mood === "string") out.mood = source.mood.slice(0, 40);
  if (Array.isArray(source.interests)) {
    out.interests = source.interests.filter((i): i is string => typeof i === "string" && !!i.trim()).slice(0, 12).map((i) => i.slice(0, 40));
  }
  if (typeof source.budgetMaxCents === "number" && Number.isFinite(source.budgetMaxCents)) {
    out.budgetMaxCents = Math.max(0, Math.min(100_000_000, Math.round(source.budgetMaxCents)));
  }
  if (typeof source.availableMinutes === "number" && Number.isFinite(source.availableMinutes)) {
    out.availableMinutes = Math.max(10, Math.min(24 * 60, Math.round(source.availableMinutes)));
  }
  if (typeof source.startPointId === "string" && source.startPointId.trim()) out.startPointId = source.startPointId.slice(0, 120);
  return PREFERENCE_KEYS.some((key) => key in out) ? out : null;
}

/** يضمن وجود ملف للتوكن، ويحدّث لقطة التفضيلات عند توفرها (optInPersist) */
export async function ensureGuestProfileWithPreferences(token: string, preferences: unknown) {
  const snapshot = sanitizePreferencesSnapshot(preferences);
  const existing = await prisma.guestProfile.findFirst({
    where: { publicTokenHash: hashGuestToken(token), deletedAt: null },
    select: { id: true },
  });
  if (existing) {
    if (snapshot) {
      const merged = await prisma.guestProfile.update({ where: { id: existing.id }, data: { preferences: snapshot as any }, select: { id: true } });
      return merged.id;
    }
    return existing.id;
  }
  const created = await prisma.guestProfile.create({
    data: {
      publicTokenHash: hashGuestToken(token),
      preferences: (snapshot ?? undefined) as any,
    },
    select: { id: true },
  });
  return created.id;
}

/** يسجل مفاتيح الأنشطة المزارة في ملف الضيف (قائمة محدودة بآخر 200) */
export async function recordVisitedKeys(profileId: string, stableKeys: string[]) {
  const clean = [...new Set(stableKeys.filter((k) => typeof k === "string" && k.trim()).map((k) => k.slice(0, 120)))];
  if (!clean.length) return;
  const profile = await prisma.guestProfile.findUnique({ where: { id: profileId }, select: { visitedKeys: true } });
  if (!profile) return;
  const merged = [...new Set([...profile.visitedKeys, ...clean])].slice(-200);
  await prisma.guestProfile.update({ where: { id: profileId }, data: { visitedKeys: merged } });
}
