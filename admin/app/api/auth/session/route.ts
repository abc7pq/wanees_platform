import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { findOrganizerSession } from "@/lib/organizer-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await isAuthed())) return NextResponse.json({ authenticated: false }, { status: 401 });
  const session = await findOrganizerSession(request);
  return NextResponse.json({
    authenticated: true,
    auth: session ? "database" : "legacy_token",
    user: session ? { id: session.user.id, email: session.user.email, displayName: session.user.displayName } : null,
    organizations: session?.user.memberships.filter((membership) => membership.organization.status === "ACTIVE").map((membership) => ({
      id: membership.organization.id,
      slug: membership.organization.slug,
      name: membership.organization.name,
      role: membership.role,
    })) ?? [],
  });
}
