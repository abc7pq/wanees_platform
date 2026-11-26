import { NextResponse } from "next/server";
import { COOKIE } from "@/lib/auth";
import { clearOrganizerCookie, revokeOrganizerSession } from "@/lib/organizer-auth";
import { enforceAdminRateLimit, isSameOrigin } from "@/lib/request-security";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "cross-origin request blocked" }, { status: 403 });
  const rate = await enforceAdminRateLimit(request, "logout", 30);
  if (!rate.allowed) return NextResponse.json({ error: "محاولات كثيرة — انتظر دقيقة" }, { status: 429 });
  await revokeOrganizerSession(request);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, "", { httpOnly: true, secure: true, maxAge: 0, path: "/" });
  const headers = clearOrganizerCookie(res);
  const cookie = headers.get("set-cookie");
  if (cookie) res.headers.append("Set-Cookie", cookie);
  return res;
}
