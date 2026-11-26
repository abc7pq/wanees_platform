import { NextResponse } from "next/server";
import { COOKIE } from "@/lib/auth";
import { clearOrganizerCookie, revokeOrganizerSession } from "@/lib/organizer-auth";

export async function POST(request: Request) {
  await revokeOrganizerSession(request);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, "", { httpOnly: true, secure: true, maxAge: 0, path: "/" });
  const headers = clearOrganizerCookie(res);
  const cookie = headers.get("set-cookie");
  if (cookie) res.headers.append("Set-Cookie", cookie);
  return res;
}
