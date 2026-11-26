import { prisma } from "@/lib/db";
import { visitorOtpStartSchema } from "@/lib/api-contracts";
import { jsonData, jsonError } from "@/lib/api-response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getSmsVerifier } from "@/lib/sms";
import {
  OTP_CHALLENGE_TTL_MS, OTP_RESEND_SECONDS, OTP_SENDS_PER_DAY, cleanVisitorName, isCrossSiteRequest, maskPhone,
  normalizeSaudiMobile, otpSendBudget, phoneScope,
} from "@/lib/visitor-identity";
import { registrationRequired, resolveEventScope } from "@/lib/visitor-store";
import { VISITOR_CONSENT_VERSION } from "../../../../../../../../../packages/contracts/src/index.ts";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

const ORGANIZATION_SENDS_PER_10_MIN = Number.parseInt(process.env.WANEES_OTP_ORG_SENDS_PER_10_MIN ?? "", 10) || 300;

function limited(request: Request, retryAfterSeconds: number) {
  const response = jsonError(request, "RATE_LIMITED", "طلبات رمز كثيرة. انتظر قليلًا ثم حاول مرة ثانية.", 429);
  response.headers.set("retry-after", String(retryAfterSeconds));
  return response;
}

/** Step 1 of registration: validate name, phone and consent, then ask the SMS provider to send a code. */
export async function POST(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  if (!process.env.DATABASE_URL) return jsonError(request, "DATABASE_UNAVAILABLE", "التسجيل غير متاح في هذا التشغيل.", 503);
  // With the flag off nobody may collect a name and phone or trigger SMS, even if a provider is configured.
  if (!registrationRequired(eventSlug)) return jsonError(request, "EVENT_NOT_FOUND", "التسجيل غير مفعّل لهذه الفعالية.", 404);
  if (isCrossSiteRequest(request.headers, request.url)) return jsonError(request, "FORBIDDEN", "طلب غير مسموح.", 403);

  const ipRate = await enforceRateLimit(request, { scope: `visitor:otp:start:${eventSlug}`, limit: 5, windowMs: 10 * 60_000 });
  if (!ipRate.allowed) return limited(request, ipRate.retryAfterSeconds);

  const parsed = visitorOtpStartSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const consentMissing = parsed.error.issues.some((issue) => issue.path[0] === "consent");
    return consentMissing
      ? jsonError(request, "VISITOR_CONSENT_REQUIRED", "وافق على حفظ بياناتك أولًا.", 400)
      : jsonError(request, "INVALID_REQUEST", "بيانات التسجيل غير صالحة.", 400, parsed.error.flatten());
  }
  if (parsed.data.consentVersion !== VISITOR_CONSENT_VERSION) {
    return jsonError(request, "VISITOR_CONSENT_REQUIRED", "تحدّث نص الموافقة. حدّث الصفحة ووافق من جديد.", 409);
  }
  const name = cleanVisitorName(parsed.data.name);
  if (!name) return jsonError(request, "INVALID_REQUEST", "اكتب اسمك بالحروف (حرفين إلى ٦٠ حرف).", 400);
  const phone = normalizeSaudiMobile(parsed.data.phone);
  if (!phone) return jsonError(request, "VISITOR_PHONE_INVALID", "اكتب رقم جوال سعودي يبدأ بـ 05.", 400);

  const phoneRate = await enforceRateLimit(request, { scope: phoneScope("visitor:otp:phone", phone), limit: 3, windowMs: 10 * 60_000 });
  if (!phoneRate.allowed) return limited(request, phoneRate.retryAfterSeconds);

  const scope = await resolveEventScope(eventSlug);
  if (!scope) return jsonError(request, "EVENT_UNAVAILABLE", "الفعالية غير متاحة حاليًا.", 503);

  // The per-IP bucket above resets for every new address, so the per-phone budget is counted from
  // stored challenges: 60 s between codes, 3 per 10 minutes, 10 per day, whatever the sender's IP.
  const now = new Date();
  const [recentForPhone, recentForOrganization] = await Promise.all([
    prisma.visitorOtpChallenge.findMany({
      where: { organizationId: scope.organizationId, phoneE164: phone, createdAt: { gt: new Date(now.getTime() - 24 * 3600_000) } },
      select: { createdAt: true },
      orderBy: { createdAt: "desc" },
      take: OTP_SENDS_PER_DAY,
    }),
    prisma.visitorOtpChallenge.count({ where: { organizationId: scope.organizationId, createdAt: { gt: new Date(now.getTime() - 10 * 60_000) } } }),
  ]);
  const budget = otpSendBudget(recentForPhone.map((row) => row.createdAt), now);
  if (!budget.allowed) return limited(request, budget.retryAfterSeconds);
  // Organization-wide circuit breaker against a distributed SMS-pumping run.
  if (recentForOrganization >= ORGANIZATION_SENDS_PER_10_MIN) {
    console.warn(JSON.stringify({ level: "warn", logger: "wanees.visitor", event: "otp_org_cap_reached", organizationId: scope.organizationId }));
    return limited(request, 600);
  }

  const verifier = getSmsVerifier(request);
  if (!verifier) return jsonError(request, "SMS_PROVIDER_UNAVAILABLE", "خدمة الرسائل غير مهيأة حاليًا. حاول لاحقًا.", 503);
  const sent = await verifier.start(phone);
  if (!sent.ok) {
    if (sent.reason === "rate_limited") return limited(request, 600);
    if (sent.reason === "invalid_number") return jsonError(request, "VISITOR_PHONE_INVALID", "تعذر الإرسال لهذا الرقم. تأكد منه.", 400);
    console.warn(JSON.stringify({ level: "warn", logger: "wanees.visitor", event: "otp_send_failed", provider: verifier.provider, phone: maskPhone(phone) }));
    return jsonError(request, "SMS_PROVIDER_UNAVAILABLE", "تعذر إرسال الرمز الحين. حاول بعد شوي.", 503);
  }

  const challenge = await prisma.visitorOtpChallenge.create({
    data: {
      organizationId: scope.organizationId,
      phoneE164: phone,
      pendingName: name,
      consentVersion: parsed.data.consentVersion,
      expiresAt: new Date(Date.now() + OTP_CHALLENGE_TTL_MS),
    },
    select: { id: true, expiresAt: true },
  });
  return jsonData(request, {
    challengeId: challenge.id,
    expiresAt: challenge.expiresAt.toISOString(),
    maskedPhone: maskPhone(phone),
    resendAfterSeconds: OTP_RESEND_SECONDS,
  }, { persistence: "postgresql" }, { status: 201 });
}
