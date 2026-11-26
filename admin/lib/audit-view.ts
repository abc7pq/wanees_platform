// Read-side helpers for the organizer audit-log screen. Pure functions so they are
// unit-tested in engine/member-rules-test.mjs without a database.
import { maskPhone } from "./visitor-access.ts";

export const AUDIT_PAGE_SIZE = 30;

const ACTION_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+){0,3}$/;
const ENTITY_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,39}$/;

export type AuditQuery = { action: string | null; entityType: string | null; cursor: AuditCursor | null; limit: number };
export type AuditCursor = { createdAt: Date; id: string };

/** Cursor = base64url("<ISO time>|<id>") of the last row on the previous page. */
export function encodeAuditCursor(row: { createdAt: Date; id: string }) {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, "utf8").toString("base64url");
}

export function decodeAuditCursor(value: string | null | undefined): AuditCursor | null | undefined {
  if (!value) return null;
  if (value.length > 120 || !/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  const [iso, id, extra] = Buffer.from(value, "base64url").toString("utf8").split("|");
  if (extra !== undefined || !iso || !id || !/^[a-z0-9]{8,40}$/i.test(id)) return undefined;
  const createdAt = new Date(iso);
  if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== iso) return undefined;
  return { createdAt, id };
}

/** Validates ?action=&entityType=&cursor=&limit=. Returns null fields when absent, an error string when malformed. */
export function parseAuditQuery(params: URLSearchParams): { ok: true; value: AuditQuery } | { ok: false; message: string } {
  const action = params.get("action")?.trim() || null;
  const entityType = params.get("entityType")?.trim() || null;
  if (action && (action.length > 80 || !ACTION_PATTERN.test(action))) return { ok: false, message: "نوع الإجراء غير صالح." };
  if (entityType && !ENTITY_PATTERN.test(entityType)) return { ok: false, message: "نوع السجل غير صالح." };
  const cursor = decodeAuditCursor(params.get("cursor"));
  if (cursor === undefined) return { ok: false, message: "مؤشر الصفحة غير صالح." };
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? AUDIT_PAGE_SIZE : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return { ok: false, message: "عدد السجلات بين 1 و100." };
  return { ok: true, value: { action, entityType, cursor, limit } };
}

/** Keyset condition for "older than the cursor" under ORDER BY createdAt DESC, id DESC. */
export function auditCursorWhere(cursor: AuditCursor | null) {
  if (!cursor) return {};
  return { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] };
}

// Keys whose values must never reach the screen, wherever they appear in a summary.
const SECRET_KEY = /(pass(word|wd)?|secret|token|hash|otp|cookie|authori[sz]ation|credential|api[_-]?key|private[_-]?key|session)/i;
const PHONE_KEY = /(phone|mobile|msisdn|e164)/i;
const PERSON_KEY = /^(name|visitorName|fullName)$/i;
const PHONE_VALUE = /^\+?[0-9][0-9 ()-]{6,}[0-9]$/;
const MAX_FIELDS = 12;
const MAX_TEXT = 80;

export type SafeSummaryField = { key: string; value: string };

function displayValue(key: string, value: unknown, entityType: string): string | null {
  if (SECRET_KEY.test(key)) return "[مخفي]";
  if (PHONE_KEY.test(key)) return typeof value === "string" ? maskPhone(value) : "[مخفي]";
  if (entityType === "Visitor" && PERSON_KEY.test(key)) return "[مخفي]";
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "نعم" : "لا";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "—";
  if (typeof value === "string") {
    if (PHONE_VALUE.test(value.trim()) && value.replace(/\D/g, "").length >= 9) return maskPhone(value.replace(/[^\d+]/g, ""));
    return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value;
  }
  if (Array.isArray(value)) return `${value.length} عنصر`;
  if (typeof value === "object") return `${Object.keys(value as object).length} حقل`;
  return null;
}

/**
 * Flattens a stored before/after summary into at most MAX_FIELDS readable key/value pairs.
 * Secrets are hidden, phone numbers masked, nested data reduced to counts, and long text cut.
 */
export function safeAuditSummary(summary: unknown, entityType: string): SafeSummaryField[] {
  if (summary === null || summary === undefined) return [];
  if (typeof summary !== "object" || Array.isArray(summary)) {
    const value = displayValue("value", summary, entityType);
    return value === null ? [] : [{ key: "value", value }];
  }
  const fields: SafeSummaryField[] = [];
  for (const [key, value] of Object.entries(summary as Record<string, unknown>)) {
    if (fields.length >= MAX_FIELDS) break;
    const safeKey = key.length > 40 ? `${key.slice(0, 40)}…` : key;
    const display = displayValue(key, value, entityType);
    if (display !== null) fields.push({ key: safeKey, value: display });
  }
  return fields;
}

/** Entity ids are shown shortened; full ids are internal. */
export function shortEntityId(id: string | null | undefined) {
  if (!id) return null;
  return id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}
