// Database side of registered visitors: scope, device lookup, visit records.
import { prisma } from "@/lib/db";
import { loadPublishedEventCatalog } from "@/lib/db-catalog";
import { sanitizePreferencesSnapshot } from "@/lib/guest-session";
import { SHORT_DEVICE_TTL_SECONDS, VISITOR_DEVICE_TTL_SECONDS, hashDeviceToken, maskPhone, readDeviceToken } from "@/lib/visitor-identity";
import { FEATURE_FLAGS, isFeatureEnabled } from "@/lib/feature-flags";
import { PITCH_EVENT_SLUG, type VisitorProfileSummary } from "../../packages/contracts/src/index.ts";

/** Registration is required for this event: flag on, real database, and not the rehearsal event. */
export function registrationRequired(eventSlug: string) {
  return isFeatureEnabled(FEATURE_FLAGS.visitorRegistration) && Boolean(process.env.DATABASE_URL) && eventSlug !== PITCH_EVENT_SLUG;
}

/** The published event and the organization that owns it. Visitors are scoped to that organization. */
export async function resolveEventScope(eventSlug: string) {
  const catalog = await loadPublishedEventCatalog(eventSlug);
  if (!catalog) return null;
  const event = await prisma.event.findUnique({ where: { id: catalog.eventId }, select: { id: true, organizationId: true } });
  return event ? { eventId: event.id, organizationId: event.organizationId } : null;
}

export async function organizationIdForEvent(eventId: string) {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { organizationId: true } });
  return event?.organizationId ?? null;
}

/**
 * Finds the registered visitor remembered on this device for the given organization.
 * `refresh` (default) slides the device and marks the visitor as seen; read-only lookups such as
 * the welcome card pass false, so opening the page does not extend the retention window.
 */
export async function resolveDeviceVisitor(request: Request, organizationId: string, options: { refresh?: boolean } = {}) {
  const token = readDeviceToken(request);
  if (!token) return null;
  const now = new Date();
  const device = await prisma.visitorDevice.findFirst({
    where: { tokenHash: hashDeviceToken(token), expiresAt: { gt: now }, visitor: { organizationId } },
    include: { visitor: true },
  });
  if (!device) return null;
  if (options.refresh === false) return { deviceId: device.id, visitor: device.visitor };
  // Only a device the visitor asked us to remember slides forward; a one-day device keeps its expiry.
  const remembered = device.expiresAt.getTime() - device.createdAt.getTime() > SHORT_DEVICE_TTL_SECONDS * 1000;
  await prisma.$transaction([
    prisma.visitorDevice.update({
      where: { id: device.id },
      data: { lastSeenAt: now, ...(remembered ? { expiresAt: new Date(now.getTime() + VISITOR_DEVICE_TTL_SECONDS * 1000) } : {}) },
    }),
    prisma.visitor.update({ where: { id: device.visitorId }, data: { lastSeenAt: now } }),
  ]);
  return { deviceId: device.id, visitor: device.visitor };
}

export async function visitorSummary(visitorId: string): Promise<VisitorProfileSummary | null> {
  const visitor = await prisma.visitor.findUnique({
    where: { id: visitorId },
    select: { name: true, phoneE164: true, preferences: true, lastSeenAt: true, _count: { select: { visits: true } } },
  });
  if (!visitor) return null;
  return {
    name: visitor.name,
    maskedPhone: maskPhone(visitor.phoneE164),
    visitCount: visitor._count.visits,
    hasPreferences: Boolean(visitor.preferences),
    lastSeenAt: visitor.lastSeenAt.toISOString(),
  };
}

/** Saves the visitor's latest answers so a returning visit can start from them. */
export async function rememberVisitorPreferences(visitorId: string, preferences: unknown) {
  const snapshot = sanitizePreferencesSnapshot(preferences);
  if (snapshot) await prisma.visitor.update({ where: { id: visitorId }, data: { preferences: snapshot as any } });
}

/**
 * Merges what the visitor told the assistant («عيالي أعمارهم 5 و 9») into the saved preferences, so a
 * returning visit starts from them. Registration already carries the visitor's consent to remember them.
 */
export async function mergeVisitorPreferences(visitorId: string, patch: { partySize?: number | null; youngestChildAge?: number | null }) {
  const visitor = await prisma.visitor.findUnique({ where: { id: visitorId }, select: { preferences: true } });
  if (!visitor) return;
  const current = visitor.preferences && typeof visitor.preferences === "object" ? visitor.preferences as Record<string, unknown> : {};
  const next: Record<string, unknown> = { ...current };
  if (patch.partySize != null) next.partySize = patch.partySize;
  if (patch.youngestChildAge != null) next.youngestChildAge = patch.youngestChildAge;
  await rememberVisitorPreferences(visitorId, next);
}

/** How many visits this registered visitor has started (this one included). */
export async function visitorVisitCount(visitorId: string) {
  return prisma.visitorVisit.count({ where: { visitorId } });
}

/**
 * The session's plan became active outside the itinerary route (an accepted assistant proposal, a plan
 * the assistant built): add its activities to the visit history, like the itinerary route does.
 */
export async function recordSessionPlan(
  session: { visitor?: { id: string } | null; visitorVisitId?: string | null; guestProfile?: { id: string } | null },
  stableKeys: string[],
) {
  if (session.visitor?.id) await recordVisitActivities(session.visitor.id, session.visitorVisitId ?? null, stableKeys).catch(() => {});
  if (session.guestProfile?.id) {
    const { recordVisitedKeys } = await import("@/lib/guest-session");
    await recordVisitedKeys(session.guestProfile.id, stableKeys).catch(() => {});
  }
}

/** Adds planned activity keys to the visit record and to the visitor's history (last 200). */
export async function recordVisitActivities(visitorId: string, visitId: string | null, stableKeys: string[]) {
  const clean = [...new Set(stableKeys.filter((key) => typeof key === "string" && key.trim()).map((key) => key.slice(0, 120)))];
  if (!clean.length) return;
  const visitor = await prisma.visitor.findUnique({ where: { id: visitorId }, select: { visitedKeys: true } });
  if (!visitor) return;
  await prisma.visitor.update({ where: { id: visitorId }, data: { visitedKeys: [...new Set([...visitor.visitedKeys, ...clean])].slice(-200) } });
  if (visitId) {
    const visit = await prisma.visitorVisit.findUnique({ where: { id: visitId }, select: { itineraryActivityKeys: true } });
    if (visit) {
      await prisma.visitorVisit.update({
        where: { id: visitId },
        data: { itineraryActivityKeys: [...new Set([...visit.itineraryActivityKeys, ...clean])].slice(-100), lastSeenAt: new Date() },
      });
    }
  }
}

export async function recordVisitRating(visitId: string, rating: number) {
  const value = Math.max(1, Math.min(5, Math.round(rating)));
  await prisma.visitorVisit.updateMany({ where: { id: visitId }, data: { rating: value, lastSeenAt: new Date() } });
}
