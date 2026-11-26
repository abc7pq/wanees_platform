import { cookies } from "next/headers";
import { createHash, timingSafeEqual } from "crypto";
import { isOrganizerPageAuthed, isOrganizerRequestAuthed } from "@/lib/organizer-auth";

export const COOKIE = "wanees_admin";

function digest(v: string): Buffer {
  return createHash("sha256").update(v).digest();
}

// مقارنة ثابتة الزمن + لا نُخزّن كلمة المرور نفسها في الكوكي بل بصمتها
export function tokenMatches(value: string | null | undefined): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || !value) return false;
  try {
    return timingSafeEqual(digest(value), digest(expected));
  } catch {
    return false;
  }
}

export function cookieValueFor(password: string): string {
  return digest(password).toString("hex");
}

// الكوكي يحمل sha256(كلمة المرور) — نقارن البصمة بالبصمة مباشرة
export function cookieMatches(value: string | null | undefined): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || !value) return false;
  try {
    return timingSafeEqual(Buffer.from(value), Buffer.from(cookieValueFor(expected)));
  } catch {
    return false;
  }
}

export async function isAuthed(): Promise<boolean> {
  const c = await cookies();
  if (cookieMatches(c.get(COOKIE)?.value)) return true;
  return isOrganizerPageAuthed();
}

function cookieFromReq(req: Request): string | null {
  const c = req.headers.get("cookie") ?? "";
  const m = c.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

export function checkAuth(req: Request): boolean {
  // يدعم ترويسة x-admin-token (القيمة الخام) أو الكوكي (البصمة)
  const header = req.headers.get("x-admin-token");
  if (header) return tokenMatches(header);
  return cookieMatches(cookieFromReq(req));
}

export async function checkAuthAsync(req: Request): Promise<boolean> {
  if (checkAuth(req)) return true;
  return isOrganizerRequestAuthed(req);
}
