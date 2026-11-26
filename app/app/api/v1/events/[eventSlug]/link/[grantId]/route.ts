import { prisma } from "@/lib/db";
import { jsonData, jsonError } from "@/lib/api-response";
import { getVisitorToken, resolveVisitorSession } from "@/lib/visitor-auth";
import { LINK_SCOPE, linkGrantState } from "@/lib/visitor-link";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string; grantId: string }> };

function noStore(response: Response) {
  response.headers.set("cache-control", "no-store");
  return response;
}

async function redeemedGrant(request: Request, eventSlug: string, grantId: string) {
  if (!getVisitorToken(request)) return jsonError(request, "SESSION_TOKEN_REQUIRED", "يلزم رمز جلسة الزيارة.", 401);
  if (!process.env.DATABASE_URL) return jsonError(request, "DATABASE_UNAVAILABLE", "ربط الشاشة غير متاح في هذا التشغيل.", 503);
  const session = await resolveVisitorSession(eventSlug, request);
  if (!session) return jsonError(request, "SESSION_NOT_FOUND", "جلسة الزيارة غير موجودة أو انتهت.", 404);
  // Only the screen that redeemed the code can use it; for anyone else the grant does not exist.
  const grant = await prisma.visitorLinkGrant.findFirst({
    where: { id: grantId.slice(0, 64), eventId: session.eventId, redeemedBySessionId: session.id },
    select: { id: true, sessionId: true, expiresAt: true, redeemedAt: true, lastUsedAt: true, revokedAt: true, session: { select: { deletedAt: true, expiresAt: true } } },
  });
  if (!grant) return jsonError(request, "LINK_ENDED", "انتهى الربط. اطلب رمز جديد من جوالك.", 410);
  return grant;
}

/**
 * What the linked screen may show: the visit's plan, read-only. No chat, no preferences, nothing the
 * visitor said. Each read keeps the link alive; a minute without one ends it.
 */
export async function GET(request: Request, context: Context) {
  const { eventSlug, grantId } = await context.params;
  const grant = await redeemedGrant(request, eventSlug, grantId);
  if (grant instanceof Response) return grant;
  const now = new Date();
  const ownerGone = Boolean(grant.session.deletedAt) || grant.session.expiresAt.getTime() <= now.getTime();
  const state = linkGrantState(grant, now);
  if (state !== "active" || ownerGone) {
    if (!grant.revokedAt) await prisma.visitorLinkGrant.update({ where: { id: grant.id }, data: { revokedAt: now } });
    return jsonError(request, "LINK_ENDED", "انتهى الربط. اطلب رمز جديد من جوالك.", 410, { reason: ownerGone ? "visit_ended" : state });
  }
  // Only a grant still active right now is extended, so a revoke between the read and this write wins.
  await prisma.visitorLinkGrant.updateMany({ where: { id: grant.id, revokedAt: null }, data: { lastUsedAt: now } });
  const itinerary = await prisma.itinerary.findFirst({
    where: { sessionId: grant.sessionId, status: "active" },
    orderBy: { generatedAt: "desc" },
    select: { items: { orderBy: { sequence: "asc" }, select: { startsAt: true, endsAt: true, walkMin: true, activity: { select: { stableKey: true, nameAr: true, zone: { select: { stableKey: true, nameAr: true } } } } } } },
  });
  return noStore(jsonData(request, {
    scope: LINK_SCOPE,
    stops: (itinerary?.items ?? []).map((item) => ({
      activityId: item.activity.stableKey,
      name: item.activity.nameAr,
      zone: item.activity.zone.stableKey,
      zoneName: item.activity.zone.nameAr,
      startsAt: item.startsAt.toISOString(),
      endsAt: item.endsAt.toISOString(),
      walkMin: item.walkMin,
    })),
  }));
}

/** «انتهيت» on the screen: the link ends now. */
export async function DELETE(request: Request, context: Context) {
  const { eventSlug, grantId } = await context.params;
  const grant = await redeemedGrant(request, eventSlug, grantId);
  if (grant instanceof Response) return grant;
  if (!grant.revokedAt) await prisma.visitorLinkGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
  return noStore(jsonData(request, { ended: true }));
}

/** The grant is read-only: nothing can be written through it. */
export async function POST(request: Request) {
  return jsonError(request, "FORBIDDEN", "الربط للقراءة فقط.", 405);
}
export const PATCH = POST;
export const PUT = POST;
