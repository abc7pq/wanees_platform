import QRCode from "qrcode";
import { prisma } from "@/lib/db";
import { jsonData, jsonError } from "@/lib/api-response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getVisitorToken, resolveVisitorSession } from "@/lib/visitor-auth";
import { PITCH_EVENT_SLUG } from "../../../../../../../packages/contracts/src/index.ts";
import { createLinkCode, hashLinkCode, LINK_CODE_TTL_MS, LINK_IDLE_MS, LINK_SCOPE, linkCodeUrl, linkGrantState } from "@/lib/visitor-link";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

async function ownerSession(request: Request, eventSlug: string) {
  if (!getVisitorToken(request)) return jsonError(request, "SESSION_TOKEN_REQUIRED", "يلزم رمز جلسة الزيارة.", 401);
  if (!process.env.DATABASE_URL) return jsonError(request, "DATABASE_UNAVAILABLE", "ربط الشاشة غير متاح في هذا التشغيل.", 503);
  const session = await resolveVisitorSession(eventSlug, request);
  if (!session) return jsonError(request, "SESSION_NOT_FOUND", "جلسة الزيارة غير موجودة أو انتهت.", 404);
  // A kiosk never hands its own (borrowed) view on, and the rehearsal has no screens to link.
  if (session.channel !== "web" || eventSlug === PITCH_EVENT_SLUG) {
    return jsonError(request, "LINK_UNAVAILABLE", "ربط الشاشة متاح من جوال الزائر فقط.", 409);
  }
  return session;
}

function noStore(response: Response) {
  response.headers.set("cache-control", "no-store");
  return response;
}

/** «اربط بشاشة»: a fresh 6-character code and its QR, valid 10 minutes, one use. Earlier unused codes stop working. */
export async function POST(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  const session = await ownerSession(request, eventSlug);
  if (session instanceof Response) return session;
  const rate = await enforceRateLimit(request, { scope: `link:create:${session.id}`, limit: 10, windowMs: 10 * 60_000 });
  if (!rate.allowed) {
    const response = jsonError(request, "RATE_LIMITED", "طلبت رموز كثيرة. حاول بعد قليل.", 429);
    response.headers.set("retry-after", String(rate.retryAfterSeconds));
    return response;
  }
  const now = new Date();
  await prisma.visitorLinkGrant.updateMany({
    where: { sessionId: session.id, redeemedAt: null, revokedAt: null },
    data: { revokedAt: now },
  });
  const expiresAt = new Date(now.getTime() + LINK_CODE_TTL_MS);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = createLinkCode();
    try {
      await prisma.visitorLinkGrant.create({
        data: { eventId: session.eventId, sessionId: session.id, codeHash: hashLinkCode(session.eventId, code), scope: LINK_SCOPE, expiresAt },
      });
      const url = linkCodeUrl(new URL(request.url).origin, eventSlug, code);
      const qrSvg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
      return noStore(jsonData(request, { code, expiresAt: expiresAt.toISOString(), scope: LINK_SCOPE, idleSeconds: LINK_IDLE_MS / 1000, url, qrSvg }, undefined, { status: 201 }));
    } catch (error) {
      // Another live code of this event hashed the same: draw again.
      if ((error as { code?: string })?.code !== "P2002") throw error;
    }
  }
  return jsonError(request, "INTERNAL_ERROR", "تعذر إنشاء الرمز. حاول مرة ثانية.", 500);
}

/** The phone's view of its latest link: waiting for a screen, linked, or over. */
export async function GET(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  const session = await ownerSession(request, eventSlug);
  if (session instanceof Response) return session;
  const grant = await prisma.visitorLinkGrant.findFirst({
    where: { sessionId: session.id },
    orderBy: { createdAt: "desc" },
    select: { expiresAt: true, redeemedAt: true, lastUsedAt: true, revokedAt: true },
  });
  return noStore(jsonData(request, grant
    ? { status: linkGrantState(grant), expiresAt: grant.expiresAt.toISOString(), scope: LINK_SCOPE }
    : { status: "none" as const }));
}

/** «أوقف الربط»: every code and screen of this visit stops at once. */
export async function DELETE(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  const session = await ownerSession(request, eventSlug);
  if (session instanceof Response) return session;
  const { count } = await prisma.visitorLinkGrant.updateMany({
    where: { sessionId: session.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return noStore(jsonData(request, { revoked: count }));
}
