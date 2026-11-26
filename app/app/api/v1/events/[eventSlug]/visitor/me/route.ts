import { prisma } from "@/lib/db";
import { jsonData, jsonError } from "@/lib/api-response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { clearVisitorCookie, hashVisitorToken, readVisitorToken } from "@/lib/public-session";
import { clearDeviceCookie, isCrossSiteRequest } from "@/lib/visitor-identity";
import { registrationRequired, resolveDeviceVisitor, resolveEventScope, visitorSummary } from "@/lib/visitor-store";
import { sanitizePreferencesSnapshot } from "@/lib/guest-session";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

/** Who this device belongs to, for the welcome-back card. 200 with visitor: null when nobody is remembered. */
export async function GET(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  const required = registrationRequired(eventSlug);
  if (!process.env.DATABASE_URL) return jsonData(request, { registrationRequired: false, visitor: null });
  const rate = await enforceRateLimit(request, { scope: `visitor:me:${eventSlug}`, limit: 60 });
  if (!rate.allowed) return jsonError(request, "RATE_LIMITED", "حاول بعد قليل.", 429);
  const scope = await resolveEventScope(eventSlug);
  if (!scope) return jsonError(request, "EVENT_UNAVAILABLE", "الفعالية غير متاحة حاليًا.", 503);
  // Read-only: opening the page must not extend how long the visitor's data is kept.
  const found = await resolveDeviceVisitor(request, scope.organizationId, { refresh: false });
  if (!found) return jsonData(request, { registrationRequired: required, visitor: null }, { persistence: "postgresql" });
  return jsonData(request, {
    registrationRequired: required,
    visitor: await visitorSummary(found.visitor.id),
    preferences: sanitizePreferencesSnapshot(found.visitor.preferences),
  }, { persistence: "postgresql" });
}

/** «احذف بياناتي»: removes the visitor, every remembered device and every visit record, and ends this visit. */
export async function DELETE(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  if (!process.env.DATABASE_URL) return jsonError(request, "DATABASE_UNAVAILABLE", "غير متاح في هذا التشغيل.", 503);
  if (isCrossSiteRequest(request.headers, request.url, false)) return jsonError(request, "FORBIDDEN", "طلب غير مسموح.", 403);
  const rate = await enforceRateLimit(request, { scope: `visitor:delete:${eventSlug}`, limit: 10 });
  if (!rate.allowed) return jsonError(request, "RATE_LIMITED", "حاول بعد قليل.", 429);
  const scope = await resolveEventScope(eventSlug);
  if (!scope) return jsonError(request, "EVENT_UNAVAILABLE", "الفعالية غير متاحة حاليًا.", 503);
  const found = await resolveDeviceVisitor(request, scope.organizationId, { refresh: false });
  const sessionToken = readVisitorToken(request);
  await prisma.$transaction(async (tx) => {
    if (sessionToken) await tx.visitorSession.deleteMany({ where: { publicTokenHash: hashVisitorToken(sessionToken) } });
    if (found) {
      // Every visit session of this visitor (other devices, earlier visits) goes too, with its
      // preferences and itineraries, instead of lingering anonymously until it expires.
      await tx.visitorSession.deleteMany({ where: { visitorId: found.visitor.id } });
      await tx.visitor.deleteMany({ where: { id: found.visitor.id, organizationId: scope.organizationId } });
    }
  });
  const response = jsonData(request, { deleted: Boolean(found) }, { persistence: "postgresql" });
  clearDeviceCookie(response);
  clearVisitorCookie(response);
  return response;
}
