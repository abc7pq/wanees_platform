// Organization member management rules. Pure functions (no database) so the guard
// rules are unit-tested in engine/member-rules-test.mjs and shared by every route.

export const MEMBER_ROLES = ["OWNER", "ADMIN", "OPERATOR", "EDITOR", "ANALYST", "VIEWER"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];
export const MEMBER_STATUSES = ["ACTIVE", "INVITED", "DISABLED"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

/** Who may list, add, change and remove organization members. */
export const MEMBER_MANAGER_ROLES: readonly MemberRole[] = ["OWNER", "ADMIN"];
/**
 * Who may read the organization audit history. Analysts read aggregated reports only
 * (docs/MASTER_BUILD_PLAN.md, "Analyst"), and the audit log is per-person staff activity,
 * so it stays with Owner and Admin.
 */
export const AUDIT_READER_ROLES: readonly MemberRole[] = ["OWNER", "ADMIN"];

export function isMemberRole(value: unknown): value is MemberRole {
  return typeof value === "string" && (MEMBER_ROLES as readonly string[]).includes(value);
}

export function canManageMembers(role: string | null | undefined) {
  return (MEMBER_MANAGER_ROLES as readonly string[]).includes(role ?? "");
}

export function canViewAudit(role: string | null | undefined) {
  return (AUDIT_READER_ROLES as readonly string[]).includes(role ?? "");
}

/** Roles the actor may hand out. Only an Owner can create or promote another Owner. */
export function assignableRoles(actorRole: string | null | undefined): MemberRole[] {
  if (actorRole === "OWNER") return [...MEMBER_ROLES];
  if (actorRole === "ADMIN") return MEMBER_ROLES.filter((role) => role !== "OWNER");
  return [];
}

export type RuleRefusal = { code: string; message: string; status: number };

const refuse = (code: string, message: string, status = 403): RuleRefusal => ({ code, message, status });

/** Can the actor add a new member with this role? */
export function checkAddMember(input: { actorRole: string | null | undefined; role: string }): RuleRefusal | null {
  if (!canManageMembers(input.actorRole)) return refuse("FORBIDDEN", "إدارة المستخدمين للمالك والمدير فقط.");
  if (!isMemberRole(input.role)) return refuse("INVALID_REQUEST", "الدور غير معروف.", 400);
  if (!assignableRoles(input.actorRole).includes(input.role)) return refuse("OWNER_ROLE_RESERVED", "منح دور المالك للمالك فقط.");
  return null;
}

type TargetInput = {
  actorRole: string | null | undefined;
  actorUserId: string;
  targetUserId: string;
  /** The target's current role in this organization. */
  targetRole: string;
  /** Active owners in this organization, the target included when they are an active owner. */
  activeOwnerCount: number;
  /** Whether the target currently counts as an active owner. */
  targetIsActiveOwner: boolean;
};

function checkTouchable(input: TargetInput): RuleRefusal | null {
  if (!canManageMembers(input.actorRole)) return refuse("FORBIDDEN", "إدارة المستخدمين للمالك والمدير فقط.");
  if (input.targetRole === "OWNER" && input.actorRole !== "OWNER") return refuse("OWNER_ROLE_RESERVED", "تعديل حساب المالك للمالك فقط.");
  return null;
}

function leavesNoOwner(input: TargetInput) {
  return input.targetIsActiveOwner && input.activeOwnerCount <= 1;
}

/** Can the actor change the target's role to nextRole? */
export function checkRoleChange(input: TargetInput & { nextRole: string }): RuleRefusal | null {
  const base = checkTouchable(input);
  if (base) return base;
  if (!isMemberRole(input.nextRole)) return refuse("INVALID_REQUEST", "الدور غير معروف.", 400);
  if (!assignableRoles(input.actorRole).includes(input.nextRole)) return refuse("OWNER_ROLE_RESERVED", "منح دور المالك للمالك فقط.");
  if (input.nextRole !== "OWNER" && leavesNoOwner(input)) return refuse("LAST_OWNER", "لا يمكن تغيير دور آخر مالك نشط. أضف مالكًا آخر أولًا.", 409);
  return null;
}

/** Can the actor remove the target from the organization? */
export function checkRemoval(input: TargetInput): RuleRefusal | null {
  const base = checkTouchable(input);
  if (base) return base;
  if (input.actorUserId === input.targetUserId) return refuse("CANNOT_REMOVE_SELF", "لا يمكنك إزالة حسابك أو تعطيله.", 409);
  if (leavesNoOwner(input)) return refuse("LAST_OWNER", "لا يمكن إزالة آخر مالك نشط.", 409);
  return null;
}

/**
 * Can the actor set the target's account status? Disabling follows the removal rules.
 * The account status is global, so it is only changed for people who belong to this
 * organization alone; others are removed from the organization instead.
 */
export function checkStatusChange(input: TargetInput & { nextStatus: string; targetMembershipCount: number }): RuleRefusal | null {
  const base = checkTouchable(input);
  if (base) return base;
  if (input.nextStatus !== "ACTIVE" && input.nextStatus !== "DISABLED") return refuse("INVALID_REQUEST", "الحالة غير معروفة.", 400);
  if (input.targetMembershipCount > 1) return refuse("MULTI_ORGANIZATION_USER", "هذا الحساب عضو في جهة أخرى؛ أزله من جهتك بدل تعطيله.", 409);
  if (input.nextStatus === "DISABLED") return checkRemoval(input);
  return null;
}

const EMAIL = /^[^\s@<>"'`]+@[^\s@<>"'`]+\.[^\s@<>"'`]+$/;

export type NewMemberInput = { email: string; displayName: string; role: MemberRole };

/** Validates the add-member body: { email, displayName, role }. */
export function parseNewMember(body: unknown): { ok: true; value: NewMemberInput } | { ok: false; message: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, message: "طلب غير صالح." };
  const record = body as Record<string, unknown>;
  const allowed = new Set(["email", "displayName", "role"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) return { ok: false, message: "حقول غير معروفة في الطلب." };
  const email = typeof record.email === "string" ? record.email.trim().toLowerCase() : "";
  const displayName = typeof record.displayName === "string" ? record.displayName.trim().replace(/\s+/g, " ") : "";
  if (!email || email.length > 254 || !EMAIL.test(email)) return { ok: false, message: "أدخل بريدًا إلكترونيًا صحيحًا." };
  if (displayName.length < 2 || displayName.length > 80 || /[\u0000-\u001f<>]/.test(displayName)) return { ok: false, message: "الاسم بين حرفين و80 حرفًا." };
  if (!isMemberRole(record.role)) return { ok: false, message: "اختر دورًا صحيحًا." };
  return { ok: true, value: { email, displayName, role: record.role } };
}

export type MemberPatch = { role: MemberRole } | { status: "ACTIVE" | "DISABLED" };

/** Validates the change-member body: exactly one of { role } or { status }. */
export function parseMemberPatch(body: unknown): { ok: true; value: MemberPatch } | { ok: false; message: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, message: "طلب غير صالح." };
  const keys = Object.keys(body);
  const record = body as Record<string, unknown>;
  if (keys.length !== 1) return { ok: false, message: "غيّر الدور أو الحالة، واحدًا في كل طلب." };
  if (keys[0] === "role") return isMemberRole(record.role) ? { ok: true, value: { role: record.role } } : { ok: false, message: "اختر دورًا صحيحًا." };
  if (keys[0] === "status") {
    return record.status === "ACTIVE" || record.status === "DISABLED"
      ? { ok: true, value: { status: record.status } }
      : { ok: false, message: "الحالة إما نشط أو معطّل." };
  }
  return { ok: false, message: "حقول غير معروفة في الطلب." };
}

/** Member ids are cuids; reject anything else before it reaches a query. */
export function isMemberId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9]{8,40}$/i.test(value);
}

const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** A one-time password from unbiased random bytes, grouped for reading aloud: xxxx-xxxx-xxxx-xxxx. */
export function generateTemporaryPassword(randomBytes: (size: number) => Uint8Array, groups = 4): string {
  const out: string[] = [];
  const limit = 256 - (256 % PASSWORD_ALPHABET.length);
  while (out.length < groups * 4) {
    for (const byte of randomBytes(32)) {
      if (byte >= limit) continue;
      out.push(PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length]);
      if (out.length === groups * 4) break;
    }
  }
  return Array.from({ length: groups }, (_, index) => out.slice(index * 4, index * 4 + 4).join("")).join("-");
}
