import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  assignableRoles, canManageMembers, canViewAudit, checkAddMember, checkRemoval, checkRoleChange, checkStatusChange,
  generateTemporaryPassword, isMemberId, parseMemberPatch, parseNewMember,
} from "../lib/member-rules.ts";
import { auditCursorWhere, decodeAuditCursor, encodeAuditCursor, parseAuditQuery, safeAuditSummary, shortEntityId } from "../lib/audit-view.ts";

const code = (refusal) => refusal?.code ?? null;

// Who may manage members and read the audit log.
for (const role of ["OWNER", "ADMIN"]) {
  assert.equal(canManageMembers(role), true, role);
  assert.equal(canViewAudit(role), true, role);
}
for (const role of ["OPERATOR", "EDITOR", "ANALYST", "VIEWER", null, undefined, "owner"]) {
  assert.equal(canManageMembers(role), false, String(role));
  assert.equal(canViewAudit(role), false, String(role));
}

// Only an Owner can hand out the Owner role.
assert.ok(assignableRoles("OWNER").includes("OWNER"));
assert.equal(assignableRoles("ADMIN").includes("OWNER"), false);
assert.deepEqual(assignableRoles("ADMIN"), ["ADMIN", "OPERATOR", "EDITOR", "ANALYST", "VIEWER"]);
assert.deepEqual(assignableRoles("VIEWER"), []);

assert.equal(checkAddMember({ actorRole: "OWNER", role: "OWNER" }), null);
assert.equal(code(checkAddMember({ actorRole: "ADMIN", role: "OWNER" })), "OWNER_ROLE_RESERVED");
assert.equal(checkAddMember({ actorRole: "ADMIN", role: "EDITOR" }), null);
assert.equal(code(checkAddMember({ actorRole: "OPERATOR", role: "VIEWER" })), "FORBIDDEN");
assert.equal(code(checkAddMember({ actorRole: "OWNER", role: "ROOT" })), "INVALID_REQUEST");

const base = { actorUserId: "actor0001", targetUserId: "target001", activeOwnerCount: 2, targetIsActiveOwner: false };

// ADMIN cannot grant or remove OWNER.
assert.equal(code(checkRoleChange({ ...base, actorRole: "ADMIN", targetRole: "VIEWER", nextRole: "OWNER" })), "OWNER_ROLE_RESERVED");
assert.equal(code(checkRoleChange({ ...base, actorRole: "ADMIN", targetRole: "OWNER", targetIsActiveOwner: true, nextRole: "ADMIN" })), "OWNER_ROLE_RESERVED");
assert.equal(code(checkRemoval({ ...base, actorRole: "ADMIN", targetRole: "OWNER", targetIsActiveOwner: true })), "OWNER_ROLE_RESERVED");
assert.equal(code(checkStatusChange({ ...base, actorRole: "ADMIN", targetRole: "OWNER", targetIsActiveOwner: true, nextStatus: "DISABLED", targetMembershipCount: 1 })), "OWNER_ROLE_RESERVED");
assert.equal(checkRoleChange({ ...base, actorRole: "ADMIN", targetRole: "VIEWER", nextRole: "ADMIN" }), null);
assert.equal(checkRemoval({ ...base, actorRole: "ADMIN", targetRole: "EDITOR" }), null);
// An Owner can promote and, with another active owner present, demote or remove owners.
assert.equal(checkRoleChange({ ...base, actorRole: "OWNER", targetRole: "ADMIN", nextRole: "OWNER" }), null);
assert.equal(checkRoleChange({ ...base, actorRole: "OWNER", targetRole: "OWNER", targetIsActiveOwner: true, nextRole: "ADMIN" }), null);
assert.equal(checkRemoval({ ...base, actorRole: "OWNER", targetRole: "OWNER", targetIsActiveOwner: true }), null);

// The last active owner cannot be demoted, disabled or removed (not even by themselves).
const lastOwner = { ...base, actorRole: "OWNER", targetRole: "OWNER", targetIsActiveOwner: true, activeOwnerCount: 1 };
assert.equal(code(checkRoleChange({ ...lastOwner, nextRole: "ADMIN" })), "LAST_OWNER");
assert.equal(code(checkRoleChange({ ...lastOwner, actorUserId: "target001", nextRole: "VIEWER" })), "LAST_OWNER");
assert.equal(checkRoleChange({ ...lastOwner, nextRole: "OWNER" }), null);
assert.equal(code(checkRemoval(lastOwner)), "LAST_OWNER");
assert.equal(code(checkStatusChange({ ...lastOwner, nextStatus: "DISABLED", targetMembershipCount: 1 })), "LAST_OWNER");
assert.equal(checkStatusChange({ ...lastOwner, nextStatus: "ACTIVE", targetMembershipCount: 1 }), null);
// An invited or disabled owner does not count as the last active owner.
assert.equal(checkRemoval({ ...lastOwner, targetIsActiveOwner: false }), null);

// You cannot remove or disable yourself; changing your own role is allowed while another owner remains.
const self = { ...base, actorRole: "OWNER", targetUserId: "actor0001", targetRole: "OWNER", targetIsActiveOwner: true };
assert.equal(code(checkRemoval(self)), "CANNOT_REMOVE_SELF");
assert.equal(code(checkStatusChange({ ...self, nextStatus: "DISABLED", targetMembershipCount: 1 })), "CANNOT_REMOVE_SELF");
assert.equal(code(checkRemoval({ ...base, actorRole: "ADMIN", targetUserId: "actor0001", targetRole: "ADMIN" })), "CANNOT_REMOVE_SELF");
assert.equal(checkRoleChange({ ...self, nextRole: "ADMIN" }), null);

// Account status is global: people in other organizations are removed, not disabled.
assert.equal(code(checkStatusChange({ ...base, actorRole: "OWNER", targetRole: "EDITOR", nextStatus: "DISABLED", targetMembershipCount: 2 })), "MULTI_ORGANIZATION_USER");
assert.equal(code(checkStatusChange({ ...base, actorRole: "OWNER", targetRole: "EDITOR", nextStatus: "INVITED", targetMembershipCount: 1 })), "INVALID_REQUEST");
// Non-managers are refused before anything else.
assert.equal(code(checkRemoval({ ...base, actorRole: "ANALYST", targetRole: "VIEWER" })), "FORBIDDEN");
assert.equal(code(checkRoleChange({ ...base, actorRole: "VIEWER", targetRole: "VIEWER", nextRole: "ADMIN" })), "FORBIDDEN");

// Input validation.
assert.deepEqual(parseNewMember({ email: " Sara@Example.COM ", displayName: "  سارة   العتيبي ", role: "EDITOR" }), { ok: true, value: { email: "sara@example.com", displayName: "سارة العتيبي", role: "EDITOR" } });
assert.equal(parseNewMember({ email: "nope", displayName: "سارة", role: "EDITOR" }).ok, false);
assert.equal(parseNewMember({ email: "a@b.co", displayName: "س", role: "EDITOR" }).ok, false);
assert.equal(parseNewMember({ email: "a@b.co", displayName: "<script>", role: "EDITOR" }).ok, false);
assert.equal(parseNewMember({ email: "a@b.co", displayName: "سارة", role: "GOD" }).ok, false);
assert.equal(parseNewMember({ email: "a@b.co", displayName: "سارة", role: "EDITOR", status: "ACTIVE" }).ok, false);
assert.equal(parseNewMember(null).ok, false);
assert.deepEqual(parseMemberPatch({ role: "ANALYST" }), { ok: true, value: { role: "ANALYST" } });
assert.deepEqual(parseMemberPatch({ status: "DISABLED" }), { ok: true, value: { status: "DISABLED" } });
assert.equal(parseMemberPatch({ status: "INVITED" }).ok, false);
assert.equal(parseMemberPatch({ role: "ADMIN", status: "ACTIVE" }).ok, false);
assert.equal(parseMemberPatch({ email: "x@y.z" }).ok, false);
assert.equal(parseMemberPatch([]).ok, false);
assert.equal(isMemberId("cmabc12345xyz"), true);
assert.equal(isMemberId("../etc"), false);
assert.equal(isMemberId(""), false);

// One-time passwords: 4 groups of 4 from an unambiguous alphabet, different each time.
const password = generateTemporaryPassword((size) => randomBytes(size));
assert.match(password, /^[A-HJ-NP-Za-km-z2-9]{4}(?:-[A-HJ-NP-Za-km-z2-9]{4}){3}$/);
assert.notEqual(password, generateTemporaryPassword((size) => randomBytes(size)));
// Bytes past the unbiased range are skipped rather than folded into the alphabet.
assert.equal(generateTemporaryPassword(() => new Uint8Array(32).fill(255).map((value, index) => (index % 2 ? 0 : value)), 1), "AAAA");

// Audit query parsing and keyset cursors.
const row = { createdAt: new Date("2026-11-26T09:30:00.000Z"), id: "cmaudit00001" };
const cursor = encodeAuditCursor(row);
assert.deepEqual(decodeAuditCursor(cursor), row);
assert.equal(decodeAuditCursor("not a cursor!"), undefined);
assert.equal(decodeAuditCursor(Buffer.from("2026-13-99|x").toString("base64url")), undefined);
assert.equal(decodeAuditCursor(null), null);
assert.deepEqual(auditCursorWhere(row), { OR: [{ createdAt: { lt: row.createdAt } }, { createdAt: row.createdAt, id: { lt: row.id } }] });
assert.deepEqual(auditCursorWhere(null), {});
const parsed = parseAuditQuery(new URLSearchParams({ action: "member.role_change", entityType: "Membership", cursor }));
assert.equal(parsed.ok, true);
assert.equal(parsed.value.limit, 30);
assert.equal(parseAuditQuery(new URLSearchParams({ action: "x'; drop" })).ok, false);
assert.equal(parseAuditQuery(new URLSearchParams({ entityType: "Visitor{}" })).ok, false);
assert.equal(parseAuditQuery(new URLSearchParams({ limit: "500" })).ok, false);
assert.equal(parseAuditQuery(new URLSearchParams({ cursor: "%%%" })).ok, false);

// Safe summaries: secrets hidden, phones masked, visitor names hidden, nested values counted.
const summary = safeAuditSummary({
  role: "ADMIN",
  passwordHash: "scrypt$abc$def",
  temporaryPassword: "ABCD-EFGH",
  phoneE164: "+966512345678",
  contact: "+966 51 234 5678",
  name: "زائر حقيقي",
  removed: true,
  revokedSessions: 2,
  keys: ["a", "b"],
  nested: { a: 1 },
  note: "x".repeat(200),
}, "Visitor");
const byKey = Object.fromEntries(summary.map((field) => [field.key, field.value]));
assert.equal(byKey.role, "ADMIN");
assert.equal(byKey.passwordHash, "[مخفي]");
assert.equal(byKey.temporaryPassword, "[مخفي]");
assert.equal(byKey.phoneE164.includes("12345"), false);
assert.ok(byKey.phoneE164.endsWith("78"));
assert.equal(byKey.contact.includes("234"), false);
assert.equal(byKey.name, "[مخفي]");
assert.equal(byKey.removed, "نعم");
assert.equal(byKey.keys, "2 عنصر");
assert.equal(byKey.nested, "1 حقل");
assert.ok(byKey.note.length <= 81);
assert.ok(!JSON.stringify(summary).includes("scrypt"));
assert.ok(!JSON.stringify(summary).includes("512345678"));
// Staff display names are not visitor data and stay readable outside Visitor rows.
assert.deepEqual(safeAuditSummary({ name: "نورة" }, "Event"), [{ key: "name", value: "نورة" }]);
assert.deepEqual(safeAuditSummary(null, "Event"), []);
assert.ok(safeAuditSummary(Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`k${index}`, index])), "Event").length <= 12);
assert.equal(shortEntityId("cm1234567890abcdef"), "cm1234…cdef");
assert.equal(shortEntityId(null), null);

console.log("member and audit rules passed");
