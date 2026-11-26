import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type Tx = Prisma.TransactionClient;

/**
 * Serializes member changes within one organization so two concurrent demotions or
 * removals cannot both pass the last-owner check.
 */
export async function lockOrganization(tx: Tx, organizationId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${organizationId} FOR UPDATE`;
}

export async function countActiveOwners(tx: Tx, organizationId: string) {
  return tx.membership.count({ where: { organizationId, role: "OWNER", user: { status: "ACTIVE" } } });
}

export async function revokeUserSessions(tx: Tx, userId: string) {
  const result = await tx.organizerSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  return result.count;
}

export const memberSelect = {
  role: true,
  createdAt: true,
  user: { select: { id: true, email: true, displayName: true, status: true, _count: { select: { memberships: true } } } },
} satisfies Prisma.MembershipSelect;

type MemberRow = Prisma.MembershipGetPayload<{ select: typeof memberSelect }>;

export function memberView(row: MemberRow, viewerUserId: string | null) {
  return {
    userId: row.user.id,
    email: row.user.email,
    displayName: row.user.displayName,
    role: row.role,
    status: row.user.status,
    joinedAt: row.createdAt.toISOString(),
    isSelf: row.user.id === viewerUserId,
    otherOrganizations: Math.max(0, row.user._count.memberships - 1),
  };
}

export async function listMembers(organizationId: string, viewerUserId: string | null) {
  const rows = await prisma.membership.findMany({
    where: { organizationId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 500,
    select: memberSelect,
  });
  return rows.map((row) => memberView(row, viewerUserId));
}

export function isUniqueViolation(error: unknown) {
  return Boolean(error) && typeof error === "object" && (error as { code?: unknown }).code === "P2002";
}
