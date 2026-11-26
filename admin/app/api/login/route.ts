import { NextResponse } from "next/server";
import { COOKIE, cookieValueFor, tokenMatches } from "@/lib/auth";
import { createOrganizerSession, findUserForLogin, setOrganizerCookie } from "@/lib/organizer-auth";
import { verifyPassword } from "@/lib/password";
import { DEMO_ADMIN_EMAIL, hasDemoAdminMembership, localDemoAllowed } from "@/lib/local-demo";
import { enforceAdminRateLimit, isSameOrigin } from "@/lib/request-security";

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
    const user = await findUserForLogin(email);
    if (user && user.status === "ACTIVE" && verifyPassword(password, user.passwordHash)
      && (isDemoAdmin ? hasDemoAdminMembership(user.memberships) : user.memberships.some((membership) => membership.organization.status === "ACTIVE"))) {
      const session = await createOrganizerSession(user.id);
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
