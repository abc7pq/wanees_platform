import { z } from "zod";
import { prisma } from "@/lib/db";
import { jsonData, jsonError } from "@/lib/api-response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getVisitorToken, resolveVisitorSession } from "@/lib/visitor-auth";
import { hashLinkCode, LINK_IDLE_MS, LINK_SCOPE, normalizeLinkCode } from "@/lib/visitor-link";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

const redeemSchema = z.object({ code: z.string().max(32) }).strict();

/**
 * A screen (kiosk) types or scans the phone's code. It works once, within 10 minutes, for this event
 * only, and gives the screen read-only access to that visit. A wrong, used, expired or revoked code all
 * answer the same, so the endpoint does not tell which codes exist.
 */
export async function POST(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  if (!getVisitorToken(request)) return jsonError(request, "SESSION_TOKEN_REQUIRED", "يلزم رمز جلسة الزيارة.", 401);
  if (!process.env.DATABASE_URL) return jsonError(request, "DATABASE_UNAVAILABLE", "ربط الشاشة غير متاح في هذا التشغيل.", 503);
  const session = await resolveVisitorSession(eventSlug, request);
  if (!session) return jsonError(request, "SESSION_NOT_FOUND", "جلسة الزيارة غير موجودة أو انتهت.", 404);
  // Guessing: 31^6 codes; 10 tries a minute per screen, 30 per network address.
  for (const [scope, limit] of [[`link:redeem:${session.id}`, 10], [`link:redeem:${eventSlug}`, 30]] as const) {
    const rate = await enforceRateLimit(request, { scope, limit });
    if (!rate.allowed) {
      const response = jsonError(request, "RATE_LIMITED", "محاولات كثيرة. انتظر دقيقة وجرب.", 429);
      response.headers.set("retry-after", String(rate.retryAfterSeconds));
      return response;
    }
  }
  const parsed = redeemSchema.safeParse(await request.json().catch(() => null));
  const code = parsed.success ? normalizeLinkCode(parsed.data.code) : null;
  if (!code) return jsonError(request, "INVALID_REQUEST", "الرمز ستة حروف وأرقام.", 400, { field: "code" });

  const now = new Date();
  const grant = await prisma.visitorLinkGrant.findUnique({
    where: { eventId_codeHash: { eventId: session.eventId, codeHash: hashLinkCode(session.eventId, code) } },
    select: { id: true, sessionId: true },
  });
  // Single use: the update only wins while the code is unredeemed, unrevoked and unexpired.
  const claimed = grant && grant.sessionId !== session.id
    ? await prisma.visitorLinkGrant.updateMany({
      where: { id: grant.id, redeemedAt: null, revokedAt: null, expiresAt: { gt: now }, session: { deletedAt: null, expiresAt: { gt: now } } },
      data: { redeemedAt: now, redeemedBySessionId: session.id, lastUsedAt: now },
    })
    : { count: 0 };
  if (!grant || claimed.count !== 1) {
    return jsonError(request, "LINK_CODE_INVALID", "الرمز غير صحيح أو انتهى. اطلب رمز جديد من جوالك.", 404);
  }
  const response = jsonData(request, { grantId: grant.id, scope: LINK_SCOPE, idleSeconds: LINK_IDLE_MS / 1000 }, undefined, { status: 201 });
  response.headers.set("cache-control", "no-store");
  return response;
}
