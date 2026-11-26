import { prisma } from "@/lib/db";
import { jsonData, jsonError } from "@/lib/api-response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { clearVisitorCookie, hashVisitorToken, readVisitorToken } from "@/lib/public-session";
import { clearDeviceCookie, hashDeviceToken, isCrossSiteRequest, readDeviceToken } from "@/lib/visitor-identity";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

/** «لست أنا»: forgets this device and ends the current visit. The visitor's record stays. */
export async function POST(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  // A cross-site page must not be able to sign a visitor out of their own device.
  if (isCrossSiteRequest(request.headers, request.url, false)) return jsonError(request, "FORBIDDEN", "طلب غير مسموح.", 403);
  const rate = await enforceRateLimit(request, { scope: `visitor:logout:${eventSlug}`, limit: 20 });
  if (!rate.allowed) return jsonError(request, "RATE_LIMITED", "حاول بعد قليل.", 429);
  const deviceToken = readDeviceToken(request);
  const sessionToken = readVisitorToken(request);
  if (process.env.DATABASE_URL) {
    if (deviceToken) await prisma.visitorDevice.deleteMany({ where: { tokenHash: hashDeviceToken(deviceToken) } });
    if (sessionToken) await prisma.visitorSession.deleteMany({ where: { publicTokenHash: hashVisitorToken(sessionToken) } });
  }
  const response = jsonData(request, { forgotten: true });
  clearDeviceCookie(response);
  clearVisitorCookie(response);
  return response;
}
