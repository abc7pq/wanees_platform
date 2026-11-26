// Lock-screen nudges (Web Push) for this visit.
// GET: is push available here, and the VAPID public key the browser subscribes with.
// PUT: the visitor tapped the opt-in and the browser granted permission → store this device's subscription.
// DELETE: turn it off for this device. Ending the visit deletes every subscription with the session.
import { prisma } from "@/lib/db";
import { jsonData, jsonError } from "@/lib/api-response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getVisitorToken, resolveVisitorSession } from "@/lib/visitor-auth";
import { pushSubscribeSchema, pushUnsubscribeSchema, SENT_HISTORY } from "@/lib/push-nudges";
import { endpointHash, isAllowedPushEndpoint, vapidConfig } from "@/lib/web-push";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

/** A visitor rarely has more than a phone and a tablet; older devices are dropped beyond this. */
const MAX_DEVICES_PER_VISIT = 3;

async function sessionOrError(request: Request, eventSlug: string) {
  if (!getVisitorToken(request)) return { error: jsonError(request, "SESSION_TOKEN_REQUIRED", "يلزم رمز جلسة الزيارة.", 401) };
  if (!process.env.DATABASE_URL) return { error: jsonError(request, "DATABASE_UNAVAILABLE", "التنبيهات تحتاج قاعدة بيانات مفعلة.", 503) };
  const session = await resolveVisitorSession(eventSlug, request);
  if (!session) return { error: jsonError(request, "SESSION_NOT_FOUND", "جلسة الزيارة غير موجودة أو انتهت.", 404) };
  return { session };
}

export async function GET(request: Request) {
  const vapid = vapidConfig();
  const response = jsonData(request, { enabled: Boolean(vapid && process.env.DATABASE_URL), publicKey: vapid?.publicKey ?? null }, { persistence: "none" });
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function PUT(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  const resolved = await sessionOrError(request, eventSlug);
  if ("error" in resolved) return resolved.error;
  const { session } = resolved;
  if (!vapidConfig()) return jsonError(request, "PUSH_UNAVAILABLE", "تنبيهات شاشة القفل غير مفعلة في هذه الفعالية.", 503);

  const rate = await enforceRateLimit(request, { scope: `push-subscribe:${eventSlug}:${session.id}`, limit: 10, windowMs: 10 * 60_000 });
  if (!rate.allowed) {
    const response = jsonError(request, "RATE_LIMITED", "طلبات كثيرة. حاول بعد قليل.", 429);
    response.headers.set("retry-after", String(rate.retryAfterSeconds));
    return response;
  }
  const parsed = pushSubscribeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(request, "INVALID_REQUEST", "بيانات الاشتراك غير صالحة.", 400);
  const { subscription, openPath, seenNudgeIds } = parsed.data;
  if (!isAllowedPushEndpoint(subscription.endpoint)) {
    return jsonError(request, "PUSH_ENDPOINT_NOT_ALLOWED", "خدمة التنبيهات في هذا المتصفح غير مدعومة.", 400);
  }

  const hash = endpointHash(subscription.endpoint);
  const fields = {
    sessionId: session.id,
    eventId: session.eventId,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
    openPath,
    sentNudgeIds: seenNudgeIds.slice(-SENT_HISTORY),
    failureCount: 0,
    expiresAt: session.expiresAt,
  };
  // The same browser re-subscribing (or starting a new visit) moves its one row to this visit.
  await prisma.pushSubscription.upsert({ where: { endpointHash: hash }, create: { endpointHash: hash, ...fields }, update: fields });
  const extra = await prisma.pushSubscription.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: "desc" },
    skip: MAX_DEVICES_PER_VISIT,
    select: { id: true },
  });
  if (extra.length) await prisma.pushSubscription.deleteMany({ where: { id: { in: extra.map((row) => row.id) } } });

  const response = jsonData(request, { subscribed: true, expiresAt: session.expiresAt.toISOString() }, { persistence: "postgresql" });
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function DELETE(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  const resolved = await sessionOrError(request, eventSlug);
  if ("error" in resolved) return resolved.error;
  const parsed = pushUnsubscribeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(request, "INVALID_REQUEST", "بيانات الاشتراك غير صالحة.", 400);
  const removed = await prisma.pushSubscription.deleteMany({ where: { sessionId: resolved.session.id, endpointHash: endpointHash(parsed.data.endpoint) } });
  return jsonData(request, { subscribed: false, removed: removed.count }, { persistence: "postgresql" });
}
