import { prisma } from "@/lib/db";
import { visitorOtpVerifySchema } from "@/lib/api-contracts";
import { jsonData, jsonError } from "@/lib/api-response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getSmsVerifier } from "@/lib/sms";
import {
  MAX_DEVICES_PER_VISITOR, OTP_MAX_ATTEMPTS, SHORT_DEVICE_TTL_SECONDS, VISITOR_DEVICE_TTL_SECONDS, createDeviceToken, hashDeviceToken,
  isCrossSiteRequest, maskPhone, setDeviceCookie, toAsciiDigits,
} from "@/lib/visitor-identity";
import { registrationRequired, resolveEventScope, visitorSummary } from "@/lib/visitor-store";
import { clearGuestCookie, hashGuestToken, mergeGuestIntoVisitor, readGuestToken } from "@/lib/guest-session";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

/**
 * Step 2 of registration: check the code with the SMS provider, then create or update the
 * visitor for this organization and remember this device. The visit itself starts with the
 * normal POST /session call, which now finds the visitor through the device cookie or header.
 */
export async function POST(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  if (!process.env.DATABASE_URL) return jsonError(request, "DATABASE_UNAVAILABLE", "التسجيل غير متاح في هذا التشغيل.", 503);
  if (!registrationRequired(eventSlug)) return jsonError(request, "EVENT_NOT_FOUND", "التسجيل غير مفعّل لهذه الفعالية.", 404);
  // A cross-site form post could otherwise plant an attacker's device cookie (login CSRF).
  if (isCrossSiteRequest(request.headers, request.url)) return jsonError(request, "FORBIDDEN", "طلب غير مسموح.", 403);

  const rate = await enforceRateLimit(request, { scope: `visitor:otp:verify:${eventSlug}`, limit: 20, windowMs: 10 * 60_000 });
  if (!rate.allowed) {
    const response = jsonError(request, "RATE_LIMITED", "محاولات كثيرة. انتظر قليلًا.", 429);
    response.headers.set("retry-after", String(rate.retryAfterSeconds));
    return response;
  }
  const parsed = visitorOtpVerifySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(request, "INVALID_REQUEST", "الرمز غير صالح.", 400, parsed.error.flatten());

  const scope = await resolveEventScope(eventSlug);
  if (!scope) return jsonError(request, "EVENT_NOT_FOUND", "الفعالية غير موجودة أو لا تملك كتالوجًا منشورًا.", 404);

  const challenge = await prisma.visitorOtpChallenge.findFirst({
    where: { id: parsed.data.challengeId, organizationId: scope.organizationId, verifiedAt: null },
  });
  if (!challenge) return jsonError(request, "OTP_CHALLENGE_NOT_FOUND", "اطلب رمزًا جديدًا.", 404);
  if (challenge.expiresAt <= new Date()) return jsonError(request, "OTP_CHALLENGE_EXPIRED", "انتهت صلاحية الرمز. اطلب رمزًا جديدًا.", 410);
  if (challenge.attempts >= OTP_MAX_ATTEMPTS) return jsonError(request, "OTP_TOO_MANY_ATTEMPTS", "محاولات كثيرة لهذا الرمز. اطلب رمزًا جديدًا.", 429);

  // Count the attempt before asking the provider, so parallel guesses cannot exceed the limit.
  const counted = await prisma.visitorOtpChallenge.updateMany({
    where: { id: challenge.id, attempts: { lt: OTP_MAX_ATTEMPTS }, verifiedAt: null },
    data: { attempts: { increment: 1 } },
  });
  if (counted.count === 0) return jsonError(request, "OTP_TOO_MANY_ATTEMPTS", "محاولات كثيرة لهذا الرمز. اطلب رمزًا جديدًا.", 429);

  const verifier = getSmsVerifier(request);
  if (!verifier) return jsonError(request, "SMS_PROVIDER_UNAVAILABLE", "خدمة الرسائل غير مهيأة حاليًا.", 503);
  const result = await verifier.check(challenge.phoneE164, toAsciiDigits(parsed.data.code));
  if (result === "invalid") return jsonError(request, "OTP_CODE_INVALID", "الرمز غير صحيح. تأكد منه وحاول مرة ثانية.", 400, { attemptsLeft: Math.max(0, OTP_MAX_ATTEMPTS - challenge.attempts - 1) });
  if (result === "expired") return jsonError(request, "OTP_CHALLENGE_EXPIRED", "انتهت صلاحية الرمز. اطلب رمزًا جديدًا.", 410);
  if (result === "rate_limited") return jsonError(request, "OTP_TOO_MANY_ATTEMPTS", "محاولات كثيرة. اطلب رمزًا جديدًا بعد قليل.", 429);
  if (result !== "approved") {
    console.warn(JSON.stringify({ level: "warn", logger: "wanees.visitor", event: "otp_check_failed", provider: verifier.provider, phone: maskPhone(challenge.phoneE164) }));
    return jsonError(request, "SMS_PROVIDER_UNAVAILABLE", "تعذر التحقق الحين. حاول بعد شوي.", 503);
  }

  const now = new Date();
  const deviceToken = createDeviceToken();
  const deviceTtlSeconds = parsed.data.rememberDevice ? VISITOR_DEVICE_TTL_SECONDS : SHORT_DEVICE_TTL_SECONDS;
  const guestToken = readGuestToken(request);
  let mergedGuest = false;
  const visitor = await prisma.$transaction(async (tx) => {
    const marked = await tx.visitorOtpChallenge.updateMany({ where: { id: challenge.id, verifiedAt: null }, data: { verifiedAt: now } });
    if (marked.count === 0) return null;
    const saved = await tx.visitor.upsert({
      where: { organizationId_phoneE164: { organizationId: scope.organizationId, phoneE164: challenge.phoneE164 } },
      update: { name: challenge.pendingName, consentVersion: challenge.consentVersion, consentedAt: now, phoneVerifiedAt: now, lastSeenAt: now },
      create: {
        organizationId: scope.organizationId,
        phoneE164: challenge.phoneE164,
        name: challenge.pendingName,
        consentVersion: challenge.consentVersion,
        consentedAt: now,
        phoneVerifiedAt: now,
      },
      select: { id: true },
    });
    await tx.visitorDevice.create({ data: { visitorId: saved.id, tokenHash: hashDeviceToken(deviceToken), expiresAt: new Date(now.getTime() + deviceTtlSeconds * 1000) } });
    // Keep the newest devices only, so one verified phone can't accumulate unlimited remembered devices.
    const stale = await tx.visitorDevice.findMany({
      where: { visitorId: saved.id },
      orderBy: { lastSeenAt: "desc" },
      skip: MAX_DEVICES_PER_VISITOR,
      select: { id: true },
    });
    if (stale.length) await tx.visitorDevice.deleteMany({ where: { id: { in: stale.map((device) => device.id) } } });
    // Audit 4.4: this browser's remembered guest profile (same organization) becomes part of the
    // visitor in the same transaction, then goes. Nothing is left half-merged.
    if (guestToken) {
      const guests = await tx.$queryRaw<Array<{ id: string; visitedKeys: string[]; preferences: unknown }>>`SELECT id, "visitedKeys", preferences FROM "GuestProfile" WHERE "organizationId" = ${scope.organizationId} AND "publicTokenHash" = ${hashGuestToken(guestToken)} AND "deletedAt" IS NULL FOR UPDATE`;
      if (guests[0]) {
        const current = await tx.$queryRaw<Array<{ visitedKeys: string[]; preferences: unknown }>>`SELECT "visitedKeys", preferences FROM "Visitor" WHERE id = ${saved.id} FOR UPDATE`;
        const merged = mergeGuestIntoVisitor(current[0] ?? { visitedKeys: [], preferences: null }, guests[0]);
        await tx.visitor.update({ where: { id: saved.id }, data: { visitedKeys: merged.visitedKeys, ...(merged.preferences ? { preferences: merged.preferences as any } : {}) } });
        await tx.guestProfile.deleteMany({ where: { id: guests[0].id } });
        mergedGuest = true;
      }
    }
    return saved;
  });
  if (!visitor) return jsonError(request, "OTP_CHALLENGE_NOT_FOUND", "استُخدم هذا الرمز من قبل. اطلب رمزًا جديدًا.", 409);

  const summary = await visitorSummary(visitor.id);
  const native = parsed.data.clientType === "native";
  const response = jsonData(request, {
    verified: true,
    visitor: summary,
    mergedGuest,
    ...(native ? { visitorToken: deviceToken } : {}),
    authMode: native ? "bearer" : "cookie",
  }, { persistence: "postgresql" }, { status: 201 });
  if (!native) setDeviceCookie(response, deviceToken, deviceTtlSeconds);
  if (mergedGuest) clearGuestCookie(response);
  return response;
}
