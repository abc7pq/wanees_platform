import { NextResponse, type NextRequest } from "next/server";
import { API_CONTRACT_VERSION } from "../packages/contracts/src/index.ts";
import { contentSecurityPolicy, createNonce, isForeignStateChange, parseAllowedOrigins } from "../packages/contracts/src/web-security.ts";

function requestId(value: string | null) {
  return value && value.length <= 120 && /^[a-zA-Z0-9._:-]+$/.test(value) ? value : crypto.randomUUID();
}

// Audit 6.3: a browser on another site cannot change a visit (403 before any route runs), and pages
// only run scripts that carry this response's nonce. Native apps, kiosks and webhooks send no Origin.
export function middleware(request: NextRequest) {
  const isApi = request.nextUrl.pathname.startsWith("/api/");
  const id = requestId(request.headers.get("x-request-id"));
  const headers = new Headers(request.headers);
  headers.set("x-request-id", id);
  headers.set("x-wanees-request-start", String(Date.now()));

  if (isApi) {
    console.info(JSON.stringify({ event: "wanees.http", phase: "start", requestId: id, method: request.method, path: request.nextUrl.pathname }));
    if (isForeignStateChange(request.method, request.headers, request.url, parseAllowedOrigins(process.env.WANEES_ALLOWED_ORIGINS))) {
      console.warn(JSON.stringify({ event: "wanees.http", phase: "refused", reason: "foreign_origin", requestId: id, method: request.method, path: request.nextUrl.pathname }));
      return NextResponse.json(
        { error: { code: "ORIGIN_FORBIDDEN", message: "هذا الطلب من موقع آخر ومرفوض." }, meta: { contractVersion: API_CONTRACT_VERSION, requestId: id } },
        { status: 403, headers: { "x-request-id": id } },
      );
    }
    const response = NextResponse.next({ request: { headers } });
    response.headers.set("x-request-id", id);
    return response;
  }

  // Pages: Next reads the nonce from the request's CSP header and puts it on its own scripts.
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
    // Pages only: not static files, images, the service worker or prefetches.
    {
      source: "/((?!api/|_next/static|_next/image|favicon.ico|icon|apple-touch-icon|brand/|sw\\.js|manifest\\.webmanifest).*)",
      missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }],
    },
  ],
};
