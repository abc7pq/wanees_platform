import { NextResponse } from "next/server";
import { API_CONTRACT_VERSION, type ApiErrorCode, type ApiMeta } from "../../packages/contracts/src/index.ts";
import { getRequestId } from "./request-id.ts";
import { archivedWriteTarget } from "./archived-event-guard.ts";

export { getRequestId };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function responseMeta(request: Request, existing: unknown = {}) : ApiMeta {
  return {
    ...(isRecord(existing) ? existing : {}),
    contractVersion: API_CONTRACT_VERSION,
    requestId: getRequestId(request),
  };
}

function normalizeBody(request: Request, response: Response, parsed: unknown) {
  if (isRecord(parsed) && ("data" in parsed || "error" in parsed)) {
    if ("error" in parsed && typeof parsed.error === "string") {
      return {
        error: { code: response.status === 401 ? "UNAUTHORIZED" : "HTTP_ERROR", message: parsed.error },
        meta: responseMeta(request, parsed.meta),
      };
    }
    return { ...parsed, meta: responseMeta(request, parsed.meta) };
  }
  if (response.ok) return { data: parsed, meta: responseMeta(request) };
  return {
    error: {
      code: response.status === 401 ? "UNAUTHORIZED" : response.status === 403 ? "FORBIDDEN" : "HTTP_ERROR",
      message: "تعذر إكمال الطلب.",
    },
    meta: responseMeta(request),
  };
}

export async function finalizeAdminResponse(response: Response, request: Request) {
  const startedAt = Number(request.headers.get("x-wanees-request-start"));
  const contentType = response.headers.get("content-type") ?? "";
  let output = response;
  if (contentType.includes("application/json") && response.status !== 204) {
    const text = await response.text();
    let parsed: unknown = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
    if (parsed !== null) {
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      headers.delete("content-encoding");
      output = NextResponse.json(normalizeBody(request, response, parsed), { status: response.status, headers });
    }
  }
  output.headers.set("x-request-id", getRequestId(request));
  if (!output.headers.has("cache-control")) output.headers.set("cache-control", "no-store");
  console.info(JSON.stringify({
    event: "wanees.http",
    service: "admin",
    phase: "complete",
    requestId: getRequestId(request),
    method: request.method,
    path: new URL(request.url).pathname,
    status: output.status,
    durationMs: Number.isFinite(startedAt) && startedAt > 0 ? Math.max(0, Date.now() - startedAt) : undefined,
  }));
  return output;
}

type RouteHandler = (request: Request, ...args: any[]) => Response | Promise<Response>;

/**
 * Normalizes every canonical organizer v1 route to the same shared envelope,
 * while keeping the route implementation focused on authorization and domain work.
 */
export function withAdminApiContract<T extends RouteHandler>(handler: T): T {
  return (async (request: Request, ...args: any[]) => {
    const target = archivedWriteTarget(request.method, new URL(request.url).pathname);
    if (target && process.env.DATABASE_URL) {
      const { isArchivedEvent } = await import("./archived-event-guard.ts");
      if (await isArchivedEvent(target)) {
        return finalizeAdminResponse(NextResponse.json({
          error: { code: "EVENT_ARCHIVED", message: "هذه الفعالية مؤرشفة وللقراءة فقط. أعدها إلى مسودة قبل أي تعديل." },
        }, { status: 409 }), request);
      }
    }
    const response = await handler(request, ...args);
    return finalizeAdminResponse(response, request);
  }) as T;
}

export function adminData<T>(request: Request, data: T, extras: Record<string, unknown> = {}, init?: ResponseInit) {
  return NextResponse.json({ data, meta: { ...extras, ...responseMeta(request) } }, init);
}

export function adminError(request: Request, code: ApiErrorCode | string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, ...(details === undefined ? {} : { details }) }, meta: responseMeta(request) }, { status });
}
