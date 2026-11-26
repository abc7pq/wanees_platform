// Twilio Verify over plain fetch (no SDK). Twilio owns code generation, expiry and attempts.
// Docs: https://www.twilio.com/docs/verify/api
import type { SmsCheckResult, SmsStartResult, SmsVerifier } from "./index.ts";

type Env = Record<string, string | undefined>;

const VERIFY_BASE = "https://verify.twilio.com/v2/Services";

export function createTwilioVerifier(env: Env, fetchImpl: typeof fetch): SmsVerifier | null {
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = env.TWILIO_AUTH_TOKEN?.trim();
  const serviceSid = env.TWILIO_VERIFY_SERVICE_SID?.trim();
  if (!accountSid || !authToken || !serviceSid || !/^VA[0-9a-f]{32}$/i.test(serviceSid)) return null;
  const authorization = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;

  async function post(path: string, form: Record<string, string>) {
    return fetchImpl(`${VERIFY_BASE}/${serviceSid}/${path}`, {
      method: "POST",
      headers: { authorization, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(10_000),
    });
  }

  return {
    provider: "twilio",
    async start(phoneE164): Promise<SmsStartResult> {
      try {
        const response = await post("Verifications", { To: phoneE164, Channel: "sms", Locale: "ar" });
        if (response.ok) return { ok: true };
        if (response.status === 429) return { ok: false, reason: "rate_limited" };
        if (response.status === 400) return { ok: false, reason: "invalid_number" };
        return { ok: false, reason: "unavailable" };
      } catch {
        return { ok: false, reason: "unavailable" };
      }
    },
    async check(phoneE164, code): Promise<SmsCheckResult> {
      try {
        const response = await post("VerificationCheck", { To: phoneE164, Code: code });
        // Twilio answers 404 once a verification has expired, been approved, or used up its attempts.
        if (response.status === 404) return "expired";
        if (response.status === 429) return "rate_limited";
        if (!response.ok) return "unavailable";
        const body = (await response.json().catch(() => ({}))) as { status?: string };
        return body.status === "approved" ? "approved" : "invalid";
      } catch {
        return "unavailable";
      }
    },
  };
}
