import { checkAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { findOrganizerSession } from "@/lib/organizer-auth";

type Role = "OWNER" | "ADMIN" | "OPERATOR" | "EDITOR" | "ANALYST" | "VIEWER";

export async function authorizeEventRequest(request: Request, eventSlug: string, roles: Role[]) {
  const legacy = checkAuth(request);
  if (legacy) {
    const event = await prisma.event.findFirst({
      where: { slug: eventSlug, organization: { slug: process.env.WANEES_ORGANIZATION_SLUG ?? "wanees-demo" } },
      select: { id: true, name: true, organizationId: true, publishedCatalogVersionId: true },
    });
    return { authorized: true, legacy: true, userId: null, membership: null, event };
  }

  const session = await findOrganizerSession(request);
  if (!session) return { authorized: false, legacy: false, userId: null, membership: null, event: null };
  const membership = session.user.memberships.find((item) => item.organization.status === "ACTIVE" && roles.includes(item.role as Role));
  if (!membership) return { authorized: false, legacy: false, userId: session.user.id, membership: null, event: null };
  const event = await prisma.event.findFirst({
    where: { slug: eventSlug, organizationId: membership.organizationId },
    select: { id: true, name: true, organizationId: true, publishedCatalogVersionId: true },
  });
  return { authorized: Boolean(event), legacy: false, userId: session.user.id, membership, event };
}

/**
 * Organization-scoped access for data that belongs to the organizer rather than one event,
 * such as registered visitors. Only database-backed organizer sessions qualify: the legacy
 * shared ADMIN_TOKEN never unlocks visitor personal data.
 */
export async function authorizeOrganizationRequest(request: Request, roles: Role[]) {
  const session = await findOrganizerSession(request);
  if (!session) return { authorized: false as const, userId: null, organizationId: null, role: null };
  const requested = new URL(request.url).searchParams.get("organization")?.trim();
  const membership = session.user.memberships.find((item) => item.organization.status === "ACTIVE"
    && roles.includes(item.role as Role)
    && (!requested || item.organization.slug === requested));
  if (!membership) return { authorized: false as const, userId: session.user.id, organizationId: null, role: null };
  return { authorized: true as const, userId: session.user.id, organizationId: membership.organizationId, role: membership.role as Role };
}
