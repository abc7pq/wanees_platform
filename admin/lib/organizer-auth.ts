import { cookies, headers } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { DEMO_ADMIN_EMAIL, hasDemoAdminMembership, localDemoAllowed } from "@/lib/local-demo";

export const ORGANIZER_COOKIE = "wanees_organizer_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function tokenFromRequest(request: Request) {
  const direct = request.headers.get("x-wanees-admin-session");
  if (direct) return direct.trim();
  const authorization = request.headers.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) return authorization.slice(7).trim();
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${ORGANIZER_COOKIE}=([^;]+)`));
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

async function tokenFromPage() {
  const store = await cookies();
  return store.get(ORGANIZER_COOKIE)?.value ?? null;
}

export async function findOrganizerSession(request?: Request) {
  if (!process.env.DATABASE_URL) return null;
  const token = request ? tokenFromRequest(request) : await tokenFromPage();
  if (!token) return null;
  try {
    const session = await prisma.organizerSession.findFirst({
      where: { tokenHash: hashToken(token), revokedAt: null, expiresAt: { gt: new Date() } },
      include: { user: { include: { memberships: { include: { organization: true } } } } },
    });
    if (!session || session.user.status !== "ACTIVE" || !session.user.memberships.some((membership) => membership.organization.status === "ACTIVE")) return null;
    if (session.user.email === DEMO_ADMIN_EMAIL
      && (!localDemoAllowed(request?.headers ?? await headers()) || !hasDemoAdminMembership(session.user.memberships))) return null;
    await prisma.organizerSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    return session;
  } catch {
    return null;
  }
}

export async function isOrganizerRequestAuthed(request: Request) {
  return Boolean(await findOrganizerSession(request));
}

export async function isOrganizerPageAuthed() {
  return Boolean(await findOrganizerSession());
}

// Throws when the database is unreachable so callers can answer 503 instead of
// reporting a wrong password for an outage.
export async function findUserForLogin(email: string) {
  if (!process.env.DATABASE_URL) return null;
  return prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: { memberships: { include: { organization: true } } },
  });
}

export async function createOrganizerSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.organizerSession.create({ data: { userId, tokenHash: hashToken(token), expiresAt } });
  return { token, expiresAt };
}

export async function revokeOrganizerSession(request: Request) {
  const token = tokenFromRequest(request);
  if (!token || !process.env.DATABASE_URL) return;
  try {
    await prisma.organizerSession.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
  } catch {
    // Logout remains idempotent even if the database is temporarily unavailable.
  }
}

export function setOrganizerCookie(response: Response, token: string, expiresAt: Date, secure = process.env.NODE_ENV === "production") {
  const headers = new Headers(response.headers);
  const value = `${ORGANIZER_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))}${secure ? "; Secure" : ""}`;
  headers.append("Set-Cookie", value);
  return headers;
}

export function clearOrganizerCookie(response: Response) {
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", `${ORGANIZER_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
  return headers;
}
