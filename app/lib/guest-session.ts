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
  visitCount: number;
  lastVisitAt: Date | null;
};

const GUEST_PROFILE_SELECT = { id: true, organizationId: true, displayName: true, preferences: true, affinityTags: true, visitedKeys: true, visitCount: true, lastVisitAt: true } as const;

export type GuestProfileLookup =
  | { status: "found"; token: string; profile: GuestProfileRecord & { organizationId: string } }
  | { status: "missing" }
  /** The same browser has profiles at more than one organization and no event was named. */
  | { status: "ambiguous" };

/**
 * يجد ملف الضيف من الكوكي داخل منظمة واحدة.
 * Profiles are scoped to an organization like registered visitors. Without an organization the
 * lookup only succeeds when this browser has exactly one profile; it never picks one by row order.
 */
export async function findGuestProfile(request: Request, organizationId?: string | null): Promise<GuestProfileLookup> {
  const token = readGuestToken(request);
  if (!token) return { status: "missing" };
  const rows = await prisma.guestProfile.findMany({
    where: { publicTokenHash: hashGuestToken(token), deletedAt: null, ...(organizationId ? { organizationId } : {}) },
    select: GUEST_PROFILE_SELECT,
    take: 2,
  });
  if (rows.length === 0) return { status: "missing" };
  if (rows.length > 1) return { status: "ambiguous" };
  return { status: "found", token, profile: rows[0] };
}

/** يجد ملف الضيف من الكوكي، أو null إن لم يوجد/حُذف أو كان غير محدد المنظمة */
export async function loadGuestProfile(request: Request, organizationId?: string | null): Promise<{ token: string; profile: GuestProfileRecord } | null> {
  const found = await findGuestProfile(request, organizationId);
  return found.status === "found" ? { token: found.token, profile: found.profile } : null;
}

/**
 * A remembered guest starts a visit (audit 4.1): counts it and returns what they did before, so the
 * new plan skips it and the agent greets them as a returning visitor.
 */
export async function startGuestVisit(profileId: string, now = new Date()) {
  return prisma.guestProfile.update({
    where: { id: profileId },
    data: { visitCount: { increment: 1 }, lastVisitAt: now, deletedAt: null },
    select: { visitCount: true, visitedKeys: true },
  });
}

/** Keeps the remembered guest's taste current: the latest plan's preferences become the snapshot. */
export async function rememberGuestPreferences(profileId: string, preferences: unknown) {
  const snapshot = sanitizePreferencesSnapshot(preferences);
  if (!snapshot) return;
  await prisma.guestProfile.update({ where: { id: profileId }, data: { preferences: snapshot as any } });
}

/** Earlier visits' activities to leave out of a fresh plan; anything the visitor asked for by name stays. */
export function repeatsToAvoid(previouslyVisited: readonly string[], mustInclude: readonly string[] = []) {
  const wanted = new Set(mustInclude);
  return [...new Set(previouslyVisited)].filter((key) => !wanted.has(key));
}

/**
 * A remembered guest registers (audit 4.4): what the anonymous profile knew moves to the visitor.
 * Visit history is merged (visitor's first, capped at 200); the guest's taste fills in only when the
 * visitor has none saved, so a registered visitor's own preferences are never overwritten.
 */
export function mergeGuestIntoVisitor(
  visitor: { visitedKeys: readonly string[]; preferences: unknown },
  guest: { visitedKeys: readonly string[]; preferences: unknown },
) {
  const visitorHasTaste = Boolean(sanitizePreferencesSnapshot(visitor.preferences));
  const guestTaste = sanitizePreferencesSnapshot(guest.preferences);
  return {
    visitedKeys: mergeVisitedKeys(visitor.visitedKeys, guest.visitedKeys, 200),
    preferences: !visitorHasTaste && guestTaste ? guestTaste : null,
  };
}

/** «حذف بياناتي»: يحذف كل ملفات هذا المتصفح عند كل المنظمات */
export async function deleteGuestProfiles(token: string) {
  const { count } = await prisma.guestProfile.deleteMany({ where: { publicTokenHash: hashGuestToken(token) } });
  return count;
}

/**
 * Appends keys to a capped history: keeps first-seen order, drops duplicates and keeps the
 * newest `limit` entries. Pure so the race-safe writers below share one tested rule.
 */
export function mergeVisitedKeys(existing: readonly string[], incoming: readonly unknown[], limit: number) {
  const clean = incoming
    .filter((key): key is string => typeof key === "string" && key.trim().length > 0)
    .map((key) => key.slice(0, 120));
  return [...new Set([...existing, ...clean])].slice(-limit);
}

/** Cleans incoming keys; empty means there is nothing to write. */
export function cleanVisitedKeys(stableKeys: readonly unknown[]) {
  return [...new Set(stableKeys.filter((key): key is string => typeof key === "string" && key.trim().length > 0).map((key) => key.slice(0, 120)))];
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
export async function ensureGuestProfileWithPreferences(token: string, organizationId: string, preferences: unknown) {
  const snapshot = sanitizePreferencesSnapshot(preferences);
  const key = { organizationId, publicTokenHash: hashGuestToken(token) };
  const upsert = () => prisma.guestProfile.upsert({
    where: { organizationId_publicTokenHash: key },
    create: { ...key, preferences: (snapshot ?? undefined) as any },
    update: snapshot ? { preferences: snapshot as any, deletedAt: null } : { deletedAt: null },
    select: { id: true },
  });
  try {
    return (await upsert()).id;
  } catch (error) {
    // Two first requests from one browser can both try the insert; the loser retries as an update.
    if ((error as { code?: string })?.code === "P2002") return (await upsert()).id;
    throw error;
  }
}

/**
 * يسجل مفاتيح الأنشطة المزارة في ملف الضيف (قائمة محدودة بآخر 200).
 * The row is locked for the read-merge-write, so two tabs planning at once cannot drop each
 * other's keys.
 */
export async function recordVisitedKeys(profileId: string, stableKeys: string[]) {
  const clean = cleanVisitedKeys(stableKeys);
  if (!clean.length) return;
  await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ visitedKeys: string[] }>>`SELECT "visitedKeys" FROM "GuestProfile" WHERE id = ${profileId} FOR UPDATE`;
    if (!locked[0]) return;
    await tx.guestProfile.update({ where: { id: profileId }, data: { visitedKeys: mergeVisitedKeys(locked[0].visitedKeys, clean, 200) } });
  });
}
