import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeOrganizationRequest } from "@/lib/catalog-auth";
import { withAdminApiContract } from "@/lib/api-response";
import { enforceAdminRateLimit, isSameOrigin } from "@/lib/request-security";
import { checkRemoval, checkRoleChange, checkStatusChange, isMemberId, MEMBER_MANAGER_ROLES, parseMemberPatch, type RuleRefusal } from "@/lib/member-rules";
import { countActiveOwners, lockOrganization, memberSelect, memberView, revokeUserSessions } from "@/lib/member-store";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ userId: string }> };

const NO_STORE = { "cache-control": "no-store" };

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: NO_STORE });
}

function refusalResponse(refusal: RuleRefusal) {
  return errorResponse(refusal.code, refusal.message, refusal.status);
}

async function prepare(request: Request, context: Context) {
  if (!isSameOrigin(request)) return { failure: errorResponse("FORBIDDEN", "cross-origin request blocked", 403) };
  const { userId } = await context.params;
  if (!isMemberId(userId)) return { failure: errorResponse("MEMBER_NOT_FOUND", "العضو غير موجود.", 404) };
  const access = await authorizeOrganizationRequest(request, [...MEMBER_MANAGER_ROLES]);
  if (!access.authorized || !access.organizationId || !access.userId) {
    return { failure: errorResponse(access.userId ? "FORBIDDEN" : "UNAUTHORIZED", access.userId ? "إدارة المستخدمين للمالك والمدير فقط." : "غير مصرح.", access.userId ? 403 : 401) };
  }
  const rate = await enforceAdminRateLimit(request, "users:write", 30);
  if (!rate.allowed) return { failure: errorResponse("RATE_LIMITED", "طلبات كثيرة. حاول بعد قليل.", 429) };
  return { failure: null, targetUserId: userId, organizationId: access.organizationId, actorUserId: access.userId, actorRole: access.role };
}

/** Changes one member: { role } or { status: "ACTIVE" | "DISABLED" }. */
export const PATCH = withAdminApiContract(async function PATCH(request: Request, context: Context) {
  const ready = await prepare(request, context);
  if (ready.failure) return ready.failure;
  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("INVALID_REQUEST", "طلب غير صالح.", 400); }
  const parsed = parseMemberPatch(body);
  if (!parsed.ok) return errorResponse("INVALID_REQUEST", parsed.message, 400);
  const { organizationId, actorUserId, actorRole, targetUserId } = ready;
  const patch = parsed.value;

  const result = await prisma.$transaction(async (tx) => {
    await lockOrganization(tx, organizationId);
    const membership = await tx.membership.findUnique({ where: { organizationId_userId: { organizationId, userId: targetUserId } }, select: memberSelect });
    if (!membership) return { kind: "missing" as const };
    const activeOwnerCount = await countActiveOwners(tx, organizationId);
    const target = {
      actorRole, actorUserId, targetUserId,
      targetRole: membership.role,
      activeOwnerCount,
      targetIsActiveOwner: membership.role === "OWNER" && membership.user.status === "ACTIVE",
    };

    if ("role" in patch) {
      const refusal = checkRoleChange({ ...target, nextRole: patch.role });
      if (refusal) return { kind: "refused" as const, refusal };
      if (patch.role === membership.role) return { kind: "ok" as const, member: memberView(membership, actorUserId) };
      const updated = await tx.membership.update({ where: { organizationId_userId: { organizationId, userId: targetUserId } }, data: { role: patch.role }, select: memberSelect });
      await tx.auditLog.create({
        data: {
          organizationId, actorUserId, action: "member.role_change", entityType: "Membership", entityId: targetUserId,
          beforeSummary: { role: membership.role }, afterSummary: { role: patch.role, displayName: membership.user.displayName },
        },
      });
      return { kind: "ok" as const, member: memberView(updated, actorUserId) };
    }

    const refusal = checkStatusChange({ ...target, nextStatus: patch.status, targetMembershipCount: membership.user._count.memberships });
    if (refusal) return { kind: "refused" as const, refusal };
    // INVITED stays INVITED on "enable": the person activates the account by signing in.
    const nextStatus = patch.status === "ACTIVE" && membership.user.status !== "DISABLED" ? membership.user.status : patch.status;
    if (nextStatus === membership.user.status) return { kind: "ok" as const, member: memberView(membership, actorUserId) };
    await tx.user.update({ where: { id: targetUserId }, data: { status: nextStatus } });
    const revokedSessions = nextStatus === "DISABLED" ? await revokeUserSessions(tx, targetUserId) : 0;
    await tx.auditLog.create({
      data: {
        organizationId, actorUserId, action: nextStatus === "DISABLED" ? "member.disable" : "member.enable", entityType: "Membership", entityId: targetUserId,
        beforeSummary: { status: membership.user.status }, afterSummary: { status: nextStatus, displayName: membership.user.displayName, revokedSessions },
      },
    });
    const updated = await tx.membership.findUniqueOrThrow({ where: { organizationId_userId: { organizationId, userId: targetUserId } }, select: memberSelect });
    return { kind: "ok" as const, member: memberView(updated, actorUserId) };
  });

  if (result.kind === "missing") return errorResponse("MEMBER_NOT_FOUND", "العضو غير موجود.", 404);
  if (result.kind === "refused") return refusalResponse(result.refusal);
  return NextResponse.json({ data: { member: result.member } }, { headers: NO_STORE });
});

/**
 * Removes a member from the organization and signs them out everywhere. An account left
 * with no organization is disabled; the user row stays so audit history keeps its actor.
 */
export const DELETE = withAdminApiContract(async function DELETE(request: Request, context: Context) {
  const ready = await prepare(request, context);
  if (ready.failure) return ready.failure;
  const { organizationId, actorUserId, actorRole, targetUserId } = ready;

  const result = await prisma.$transaction(async (tx) => {
    await lockOrganization(tx, organizationId);
    const membership = await tx.membership.findUnique({ where: { organizationId_userId: { organizationId, userId: targetUserId } }, select: memberSelect });
    if (!membership) return { kind: "missing" as const };
    const refusal = checkRemoval({
      actorRole, actorUserId, targetUserId,
      targetRole: membership.role,
      activeOwnerCount: await countActiveOwners(tx, organizationId),
      targetIsActiveOwner: membership.role === "OWNER" && membership.user.status === "ACTIVE",
    });
    if (refusal) return { kind: "refused" as const, refusal };
    await tx.membership.delete({ where: { organizationId_userId: { organizationId, userId: targetUserId } } });
    const accountDisabled = membership.user._count.memberships <= 1 && membership.user.status !== "DISABLED";
    if (accountDisabled) await tx.user.update({ where: { id: targetUserId }, data: { status: "DISABLED" } });
    const revokedSessions = await revokeUserSessions(tx, targetUserId);
    await tx.auditLog.create({
      data: {
        organizationId, actorUserId, action: "member.remove", entityType: "Membership", entityId: targetUserId,
        beforeSummary: { role: membership.role, status: membership.user.status, displayName: membership.user.displayName, email: membership.user.email },
        afterSummary: { removed: true, accountDisabled, revokedSessions },
      },
    });
    return { kind: "removed" as const, accountDisabled };
  });

  if (result.kind === "missing") return errorResponse("MEMBER_NOT_FOUND", "العضو غير موجود.", 404);
  if (result.kind === "refused") return refusalResponse(result.refusal);
  return NextResponse.json({ data: { removed: true, accountDisabled: result.accountDisabled } }, { headers: NO_STORE });
});
