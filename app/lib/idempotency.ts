import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { jsonData, jsonError } from "@/lib/api-response";

const KEY_MAX_LENGTH = 200;
// Printable ASCII without spaces: the value travels as one HTTP header.
const KEY_PATTERN = /^[\x21-\x7E]+$/;
const RESPONSE_TTL_MS = 24 * 60 * 60_000;
// A reservation older than this is treated as abandoned (crashed request) and may be taken over.
const IN_FLIGHT_STALE_MS = 30_000;
const WAIT_INTERVAL_MS = 100;
const MAX_WAIT_ATTEMPTS = 15;

export type IdempotentResponseBody = { data: unknown; meta: Record<string, unknown> };

export type IdempotencyOutcome =
  | { kind: "disabled" }
  | { kind: "proceed"; recordId: string }
  | { kind: "replay"; statusCode: number; body: IdempotentResponseBody }
  | { kind: "invalid"; message: string }
  | { kind: "reused" }
  | { kind: "in_progress"; retryAfterSeconds: number };

type HeaderResult =
  | { kind: "disabled" }
  | { kind: "invalid"; message: string }
  | { kind: "key"; key: string };

function readIdempotencyHeader(request: Request): HeaderResult {
  const raw = request.headers.get("idempotency-key");
  if (raw === null) return { kind: "disabled" };
  const key = raw.trim();
  if (!key) return { kind: "invalid", message: "ترويسة Idempotency-Key فارغة." };
  if (key.length > KEY_MAX_LENGTH || !KEY_PATTERN.test(key)) {
    return { kind: "invalid", message: `يجب أن يتكون Idempotency-Key من 1 إلى ${KEY_MAX_LENGTH} حرفًا ASCII مرئيًا بدون مسافات.` };
  }
  return { kind: "key", key };
}

function isUniqueViolation(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2002",
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

/** Deterministic fingerprint of the request body so the same key with a different body is rejected. */
export function requestFingerprint(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

/**
 * Reserve the key, replay a stored response, or report why the key cannot be used.
 * The unique (sessionId, key) index is the lock: only one request per key proceeds.
 */
export async function beginIdempotency(
  request: Request,
  options: { sessionId?: string; eventId?: string; scope: string; payload: unknown },
): Promise<IdempotencyOutcome> {
  const header = readIdempotencyHeader(request);
  if (header.kind === "disabled") return { kind: "disabled" };
  if (header.kind === "invalid") return { kind: "invalid", message: header.message };

  const { sessionId, eventId, scope, payload } = options;
  if (!sessionId && !eventId) throw new Error("Idempotency requires a sessionId or eventId");
  const requestHash = requestFingerprint(payload);
  const expiresAt = new Date(Date.now() + RESPONSE_TTL_MS);

  for (let attempt = 0; attempt < MAX_WAIT_ATTEMPTS; attempt += 1) {
    try {
      const created = await prisma.idempotencyRecord.create({
        data: {
          sessionId: sessionId ?? undefined,
          eventId: eventId ?? undefined,
          key: header.key,
          scope,
          requestHash,
          status: "in_progress",
          expiresAt,
        },
      });
      return { kind: "proceed", recordId: created.id };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }

    const existing = await prisma.idempotencyRecord.findFirst({
      where: {
        key: header.key,
        ...(sessionId ? { sessionId } : { eventId }),
      },
    });
    if (!existing) continue;

    if (existing.scope !== scope || existing.requestHash !== requestHash) return { kind: "reused" };

    if (existing.status === "completed" && existing.responseBody) {
      return {
        kind: "replay",
        statusCode: existing.statusCode ?? 200,
        body: existing.responseBody as unknown as IdempotentResponseBody,
      };
    }

    const ageMs = Date.now() - existing.createdAt.getTime();
    if (ageMs > IN_FLIGHT_STALE_MS) {
      const takeover = await prisma.idempotencyRecord.updateMany({
        where: { id: existing.id, status: "in_progress", createdAt: existing.createdAt },
        data: { createdAt: new Date() },
      });
      if (takeover.count === 1) return { kind: "proceed", recordId: existing.id };
    }

    await sleep(WAIT_INTERVAL_MS);
  }

  return { kind: "in_progress", retryAfterSeconds: 2 };
}

/** Store the successful response so a retry with the same key replays it instead of writing again. */
export async function completeIdempotency(
  recordId: string,
  statusCode: number,
  body: { data: unknown; meta: Record<string, unknown> },
) {
  const responseBody = JSON.parse(JSON.stringify(body)) as Prisma.InputJsonValue;
  await prisma.idempotencyRecord.update({
    where: { id: recordId },
    data: { status: "completed", statusCode, responseBody, completedAt: new Date() },
  });
}

/** Release a reservation whose request failed before writing, so the client may retry with the same key. */
export async function abandonIdempotency(recordId: string) {
  await prisma.idempotencyRecord.deleteMany({ where: { id: recordId, status: "in_progress" } });
}

export function replayIdempotentResponse(
  request: Request,
  body: IdempotentResponseBody,
  statusCode: number,
) {
  const { contractVersion: _contractVersion, requestId: _requestId, ...extras } = body.meta ?? {};
  const response = jsonData(request, body.data, extras, { status: statusCode });
  response.headers.set("idempotent-replay", "true");
  return response;
}

/** Map an unusable key to its contract error, or null when the request can continue. */
export function idempotencyErrorResponse(request: Request, outcome: IdempotencyOutcome) {
  if (outcome.kind === "invalid") {
    return jsonError(request, "IDEMPOTENCY_KEY_INVALID", outcome.message, 400);
  }
  if (outcome.kind === "reused") {
    return jsonError(
      request,
      "IDEMPOTENCY_KEY_REUSED",
      "تم استخدام مفتاح التكرار نفسه لطلب مختلف. استخدم مفتاحًا جديدًا للطلب الجديد.",
      409,
    );
  }
  if (outcome.kind === "in_progress") {
    const response = jsonError(
      request,
      "IDEMPOTENCY_REQUEST_IN_PROGRESS",
      "الطلب الأصلي بهذا المفتاح قيد التنفيذ. أعد المحاولة بعد لحظات.",
      409,
    );
    response.headers.set("retry-after", String(outcome.retryAfterSeconds));
    return response;
  }
  return null;
}
