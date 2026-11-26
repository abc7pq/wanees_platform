import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";

const KEY_MAX_LENGTH = 200;
const KEY_PATTERN = /^[\x21-\x7E]+$/;
const RESPONSE_TTL_MS = 24 * 60 * 60_000;
const IN_FLIGHT_STALE_MS = 30_000;

export type AdminIdempotentBody = { data: unknown; meta: Record<string, unknown> };
export type AdminIdempotencyOutcome =
  | { kind: "disabled" }
  | { kind: "proceed"; recordId: string }
  | { kind: "replay"; statusCode: number; body: AdminIdempotentBody }
  | { kind: "invalid"; message: string }
  | { kind: "reused" }
  | { kind: "in_progress" };

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

export function requestFingerprint(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export async function beginAdminIdempotency(request: Request, options: { eventId: string; scope: string; payload: unknown }): Promise<AdminIdempotencyOutcome> {
  const raw = request.headers.get("idempotency-key");
  if (raw === null) return { kind: "disabled" };
  const key = raw.trim();
  if (!key || key.length > KEY_MAX_LENGTH || !KEY_PATTERN.test(key)) {
    return { kind: "invalid", message: `يجب أن يتكون Idempotency-Key من 1 إلى ${KEY_MAX_LENGTH} حرفًا ASCII مرئيًا بدون مسافات.` };
  }
  const requestHash = requestFingerprint(options.payload);
  const expiresAt = new Date(Date.now() + RESPONSE_TTL_MS);
  try {
    const created = await prisma.idempotencyRecord.create({
      data: { eventId: options.eventId, key, scope: options.scope, requestHash, status: "in_progress", expiresAt },
    });
    return { kind: "proceed", recordId: created.id };
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "P2002")) throw error;
  }

  const existing = await prisma.idempotencyRecord.findFirst({ where: { eventId: options.eventId, key } });
  if (!existing) return beginAdminIdempotency(request, options);
  if (existing.scope !== options.scope || existing.requestHash !== requestHash) return { kind: "reused" };
  if (existing.status === "completed" && existing.responseBody) {
    return { kind: "replay", statusCode: existing.statusCode ?? 200, body: existing.responseBody as unknown as AdminIdempotentBody };
  }
  if (Date.now() - existing.createdAt.getTime() > IN_FLIGHT_STALE_MS) {
    const takeover = await prisma.idempotencyRecord.updateMany({ where: { id: existing.id, status: "in_progress", createdAt: existing.createdAt }, data: { createdAt: new Date() } });
    if (takeover.count === 1) return { kind: "proceed", recordId: existing.id };
  }
  return { kind: "in_progress" };
}

export async function completeAdminIdempotency(recordId: string, statusCode: number, body: AdminIdempotentBody) {
  await prisma.idempotencyRecord.update({
    where: { id: recordId },
    data: { status: "completed", statusCode, responseBody: JSON.parse(JSON.stringify(body)), completedAt: new Date() },
  });
}

export async function abandonAdminIdempotency(recordId: string) {
  await prisma.idempotencyRecord.deleteMany({ where: { id: recordId, status: "in_progress" } });
}

export function adminIdempotencyFailure(outcome: AdminIdempotencyOutcome) {
  if (outcome.kind === "invalid") return { code: "IDEMPOTENCY_KEY_INVALID", message: outcome.message, status: 400 };
  if (outcome.kind === "reused") return { code: "IDEMPOTENCY_KEY_REUSED", message: "تم استخدام مفتاح التكرار نفسه لطلب مختلف. استخدم مفتاحًا جديدًا للطلب الجديد.", status: 409 };
  if (outcome.kind === "in_progress") return { code: "IDEMPOTENCY_REQUEST_IN_PROGRESS", message: "الطلب الأصلي بهذا المفتاح قيد التنفيذ. أعد المحاولة بعد لحظات.", status: 409 };
  return null;
}

export function replayAdminIdempotency(outcome: Extract<AdminIdempotencyOutcome, { kind: "replay" }>) {
  const response = Response.json({ data: outcome.body.data, meta: outcome.body.meta }, { status: outcome.statusCode });
  response.headers.set("idempotent-replay", "true");
  return response;
}
