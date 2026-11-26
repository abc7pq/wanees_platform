import { NextResponse } from "next/server";
import {
  API_CONTRACT_VERSION,
  type ApiErrorCode,
  type ApiMeta,
} from "../../packages/contracts/src/index.ts";
import { getRequestId } from "./request-id.ts";

export { getRequestId };

export function responseMeta(request: Request, extras: Record<string, unknown> = {}): ApiMeta {
  return { contractVersion: API_CONTRACT_VERSION, requestId: getRequestId(request), ...extras };
}

function finalize<T>(response: NextResponse<T>, request: Request, cacheControl = "no-store") {
  response.headers.set("x-request-id", getRequestId(request));
  response.headers.set("cache-control", cacheControl);
  const startedAt = Number(request.headers.get("x-wanees-request-start"));
  console.info(JSON.stringify({
    event: "wanees.http",
    phase: "complete",
    requestId: getRequestId(request),
    method: request.method,
    path: new URL(request.url).pathname,
    status: response.status,
    durationMs: Number.isFinite(startedAt) && startedAt > 0 ? Math.max(0, Date.now() - startedAt) : undefined,
  }));
  return response;
}

export function jsonData<T>(request: Request, data: T, extras: Record<string, unknown> = {}, init?: ResponseInit) {
  const response = NextResponse.json({ data, meta: responseMeta(request, extras) }, init);
  return finalize(response, request);
}

export function jsonError(
  request: Request,
  code: ApiErrorCode | string,
  message: string,
  status: number,
  details?: unknown,
  extras: Record<string, unknown> = {},
) {
  const response = NextResponse.json(
    { error: { code, message, ...(details === undefined ? {} : { details }) }, meta: responseMeta(request, extras) },
    { status },
  );
  return finalize(response, request);
}

