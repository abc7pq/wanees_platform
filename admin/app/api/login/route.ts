import { NextResponse } from "next/server";
import { COOKIE, cookieValueFor, tokenMatches } from "@/lib/auth";
import { createOrganizerSession, findUserForLogin, setOrganizerCookie } from "@/lib/organizer-auth";
import { verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/db";
import { DEMO_ADMIN_EMAIL, hasDemoAdminMembership, localDemoAllowed } from "@/lib/local-demo";
import { enforceAdminRateLimit, isSameOrigin } from "@/lib/request-security";

async function activateInvitedUser(userId: string, organizationIds: string[]) {
  return prisma.$transaction(async (tx) => {
    const result = await tx.user.updateMany({ where: { id: userId, status: "INVITED" }, data: { status: "ACTIVE" } });
    if (result.count) {
      await tx.auditLog.createMany({
        data: organizationIds.map((organizationId) => ({ organizationId, actorUserId: userId, action: "member.activate", entityType: "Membership", entityId: userId, afterSummary: { status: "ACTIVE" } })),
      });
    }
    return true;
  });
}

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "cross-origin request blocked" }, { status: 403 });
  const secure = (req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "")) === "https";
  const rate = await enforceAdminRateLimit(req, "login", 8);
  if (!rate.allowed) {
    const response = NextResponse.json({ error: "محاولات كثيرة — انتظر دقيقة" }, { status: 429 });
    response.headers.set("retry-after", String(rate.retryAfterSeconds));
    return response;
  }
  let password = "";
  let email = "";
  try {
    const body = await req.json();
    password = String(body?.password ?? "");
    email = String(body?.email ?? "").trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }
  const isDemoAdmin = email === DEMO_ADMIN_EMAIL;
  if (isDemoAdmin && !localDemoAllowed(req.headers)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (email && process.env.DATABASE_URL) {
    let user: Awaited<ReturnType<typeof findUserForLogin>>;
    try {
      user = await findUserForLogin(email);
    } catch {
      return NextResponse.json({ error: "الخدمة غير متاحة مؤقتًا — حاول بعد قليل" }, { status: 503 });
    }
    // INVITED members (added from /users with a one-time password) become ACTIVE on first sign-in.
    if (user && (user.status === "ACTIVE" || user.status === "INVITED") && verifyPassword(password, user.passwordHash)
      && (isDemoAdmin ? hasDemoAdminMembership(user.memberships) : user.memberships.some((membership) => membership.organization.status === "ACTIVE"))) {
      if (user.status === "INVITED") {
        const activated = await activateInvitedUser(user.id, user.memberships.map((membership) => membership.organizationId)).catch(() => false);
        if (!activated) return NextResponse.json({ error: "الخدمة غير متاحة مؤقتًا — حاول بعد قليل" }, { status: 503 });
      }
      const session = await createOrganizerSession(user.id).catch(() => null);
      if (!session) return NextResponse.json({ error: "الخدمة غير متاحة مؤقتًا — حاول بعد قليل" }, { status: 503 });
      const res = NextResponse.json({ ok: true, auth: "database", user: { id: user.id, email: user.email, displayName: user.displayName } });
      const headers = setOrganizerCookie(res, session.token, session.expiresAt, secure);
      const cookie = headers.get("set-cookie");
      if (cookie) res.headers.set("Set-Cookie", cookie);
      return res;
    }
  }
  if (isDemoAdmin || !tokenMatches(password)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  // الكوكي يحمل بصمة sha256 لكلمة المرور لا نصها، وعبر https فقط.
  // محليًا (http://localhost) لا تقبل المتصفحات كوكي secure، فتُفعَّل حسب البروتوكول.
  res.cookies.set(COOKIE, cookieValueFor(password), {
    httpOnly: true, sameSite: "strict", secure, maxAge: 60 * 60 * 12, path: "/",
  });
  return res;
}
