import { NextResponse, type NextRequest } from "next/server";

function requestId(value: string | null) {
  return value && value.length <= 120 && /^[a-zA-Z0-9._:-]+$/.test(value) ? value : crypto.randomUUID();
}

export function middleware(request: NextRequest) {
  const id = requestId(request.headers.get("x-request-id"));
  const headers = new Headers(request.headers);
  headers.set("x-request-id", id);
  headers.set("x-wanees-request-start", String(Date.now()));
  console.info(JSON.stringify({ event: "wanees.http", phase: "start", requestId: id, method: request.method, path: request.nextUrl.pathname }));
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("x-request-id", id);
  return response;
}

export const config = { matcher: "/api/:path*" };
