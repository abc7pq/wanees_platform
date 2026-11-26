import { NextResponse } from "next/server";
import { findOrganizerSession } from "@/lib/organizer-auth";
import { withAdminApiContract } from "@/lib/api-response";
import { enforceAdminRateLimit } from "@/lib/request-security";
import { canManageMembers, canViewAudit } from "@/lib/member-rules";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** The signed-in organizer, their active organizations and what each role allows (drives the nav). */
export const GET = withAdminApiContract(async function GET(request: Request) {
  const session = await findOrganizerSession(request);
  if (!session) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "غير مصرح." } }, { status: 401, headers: NO_STORE });
  const rate = await enforceAdminRateLimit(request, "me", 120);
  if (!rate.allowed) return NextResponse.json({ error: { code: "RATE_LIMITED", message: "طلبات كثيرة. حاول بعد قليل." } }, { status: 429, headers: NO_STORE });
  const memberships = session.user.memberships
    .filter((membership) => membership.organization.status === "ACTIVE")
    .map((membership) => ({
      organization: { slug: membership.organization.slug, name: membership.organization.name },
      role: membership.role,
      permissions: { manageMembers: canManageMembers(membership.role), viewAudit: canViewAudit(membership.role) },
    }));
  return NextResponse.json({
    data: {
      user: { id: session.user.id, email: session.user.email, displayName: session.user.displayName },
      memberships,
      permissions: {
        manageMembers: memberships.some((membership) => membership.permissions.manageMembers),
        viewAudit: memberships.some((membership) => membership.permissions.viewAudit),
      },
    },
  }, { headers: NO_STORE });
});
