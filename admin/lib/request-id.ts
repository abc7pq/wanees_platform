import { randomUUID } from "node:crypto";

function safeRequestId(value: string | null) {
  if (!value || value.length > 120 || !/^[a-zA-Z0-9._:-]+$/.test(value)) return randomUUID();
  return value;
}

const requestIds = new WeakMap<Request, string>();

export function getRequestId(request: Request) {
  const cached = requestIds.get(request);
  if (cached) return cached;
  const value = safeRequestId(request.headers.get("x-request-id"));
  requestIds.set(request, value);
  return value;
}
