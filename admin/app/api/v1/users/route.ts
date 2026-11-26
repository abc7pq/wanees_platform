import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeOrganizationRequest } from "@/lib/catalog-auth";
import { withAdminApiContract } from "@/lib/api-response";
import { enforceAdminRateLimit, isSameOrigin, isSameOriginRead } from "@/lib/request-security";
import { hashPassword } from "@/lib/password";
import { assignableRoles, checkAddMember, generateTemporaryPassword, MEMBER_MANAGER_ROLES, parseNewMember } from "@/lib/member-rules";
import { isUniqueViolation, listMembers, lockOrganization, memberSelect, memberView } from "@/lib/member-store";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: NO_STORE });
}

async function authorize(request: Request) {
  const access = await authorizeOrganizationRequest(request, [...MEMBER_MANAGER_ROLES]);
  if (access.authorized) return { access, failure: null };
  return {
    access,
    failure: errorResponse(access.userId ? "FORBIDDEN" : "UNAUTHORIZED", access.userId ? "إدارة المستخدمين للمالك والمدير فقط." : "غير مصرح.", access.userId ? 403 : 401),
  };
}

/** Lists the members of the caller's organization (Owner/Admin). */
export const GET = withAdminApiContract(async function GET(request: Request) {
  const { access, failure } = await authorize(request);
  if (failure || !access.organizationId) return failure!;
  if (!isSameOriginRead(request)) return errorResponse("FORBIDDEN", "تعذر التحقق من مصدر الطلب.", 403);
  const rate = await enforceAdminRateLimit(request, "users:list", 60);
  if (!rate.allowed) return errorResponse("RATE_LIMITED", "طلبات كثيرة. حاول بعد قليل.", 429);
  const [organization, members] = await Promise.all([
    prisma.organization.findUnique({ where: { id: access.organizationId }, select: { slug: true, name: true } }),
    listMembers(access.organizationId, access.userId),
  ]);
  return NextResponse.json({
    data: {
      organization,
      viewer: { userId: access.userId, role: access.role },
      assignableRoles: assignableRoles(access.role),
      members,
    },
  }, { headers: NO_STORE });
});

/**
 * Adds a member: { email, displayName, role }. A new account is created INVITED with a
 * one-time password returned once in this response; an existing account is only linked.
 */
export const POST = withAdminApiContract(async function POST(request: Request) {
  if (!isSameOrigin(request)) return errorResponse("FORBIDDEN", "cross-origin request blocked", 403);
  const { access, failure } = await authorize(request);
  if (failure || !access.organizationId) return failure!;
  const rate = await enforceAdminRateLimit(request, "users:write", 30);
  if (!rate.allowed) return errorResponse("RATE_LIMITED", "طلبات كثيرة. حاول بعد قليل.", 429);
  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("INVALID_REQUEST", "طلب غير صالح.", 400); }
  const parsed = parseNewMember(body);
  if (!parsed.ok) return errorResponse("INVALID_REQUEST", parsed.message, 400);
  const refusal = checkAddMember({ actorRole: access.role, role: parsed.value.role });
  if (refusal) return errorResponse(refusal.code, refusal.message, refusal.status);

  const { email, displayName, role } = parsed.value;
  const organizationId = access.organizationId;
  const temporaryPassword = generateTemporaryPassword((size) => randomBytes(size));
  // Hashed before the transaction so the organization lock is not held during scrypt.
  const passwordHash = hashPassword(temporaryPassword);
  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, organizationId);
      const existing = await tx.user.findUnique({ where: { email }, select: { id: true, memberships: { where: { organizationId }, select: { id: true } } } });
      if (existing?.memberships.length) return { kind: "exists" as const };
      const userId = existing
        ? existing.id
        : (await tx.user.create({ data: { email, displayName, status: "INVITED", passwordHash }, select: { id: true } })).id;
      const membership = await tx.membership.create({ data: { organizationId, userId, role }, select: memberSelect });
      await tx.auditLog.create({
        data: {
          organizationId,
          actorUserId: access.userId,
          action: "member.add",
          entityType: "Membership",
          entityId: userId,
          afterSummary: { email, displayName: membership.user.displayName, role, status: membership.user.status, existingAccount: Boolean(existing) },
        },
      });
      return { kind: "added" as const, member: memberView(membership, access.userId), existingAccount: Boolean(existing) };
    });
    if (result.kind === "exists") return errorResponse("MEMBER_EXISTS", "هذا البريد عضو في الجهة مسبقًا.", 409);
    return NextResponse.json({
      data: {
        member: result.member,
        existingAccount: result.existingAccount,
        // Shown once to the person who added the member; never stored in plain text or logged.
        temporaryPassword: result.existingAccount ? null : temporaryPassword,
      },
    }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (isUniqueViolation(error)) return errorResponse("MEMBER_EXISTS", "هذا البريد مستخدم. حاول مرة أخرى.", 409);
    throw error;
  }
});
