import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy, createNonce } from "../packages/contracts/src/web-security.ts";

function requestId(value: string | null) {
  return value && value.length <= 120 && /^[a-zA-Z0-9._:-]+$/.test(value) ? value : crypto.randomUUID();
}

// Audit 6.3: organizer pages only run scripts that carry this response's nonce. The API routes keep
// their own same-origin checks (lib/request-security.ts).
export function middleware(request: NextRequest) {
  const id = requestId(request.headers.get("x-request-id"));
  const headers = new Headers(request.headers);
  headers.set("x-request-id", id);
  headers.set("x-wanees-request-start", String(Date.now()));
  if (request.nextUrl.pathname.startsWith("/api/")) {
    console.info(JSON.stringify({ event: "wanees.http", phase: "start", requestId: id, method: request.method, path: request.nextUrl.pathname }));
    const response = NextResponse.next({ request: { headers } });
    response.headers.set("x-request-id", id);
    return response;
  }
  const nonce = createNonce();
  const policy = contentSecurityPolicy(nonce, { development: process.env.NODE_ENV === "development" });
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("content-security-policy", policy);
  response.headers.set("x-request-id", id);
  return response;
}

export const config = {
  matcher: [
    "/api/:path*",
    {
      source: "/((?!api/|_next/static|_next/image|favicon.ico|icon|apple-touch-icon|brand/).*)",
      missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }],
    },
  ],
};
