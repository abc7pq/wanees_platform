// SMS verification adapter. The provider generates, sends, expires and checks the code;
// WANEES never stores or logs a code. Selected with WANEES_SMS_PROVIDER=twilio|test.
import { isLoopbackRequest, testSmsAllowed } from "../visitor-identity.ts";
import { createTestVerifier } from "./test.ts";
import { createTwilioVerifier } from "./twilio.ts";

export type SmsStartResult = { ok: true } | { ok: false; reason: "rate_limited" | "invalid_number" | "unavailable" };
export type SmsCheckResult = "approved" | "invalid" | "expired" | "rate_limited" | "unavailable";

export interface SmsVerifier {
  readonly provider: "twilio" | "test";
  start(phoneE164: string): Promise<SmsStartResult>;
  check(phoneE164: string, code: string): Promise<SmsCheckResult>;
}

type Env = Record<string, string | undefined>;

/** Returns the configured verifier, or null when SMS is not set up for this request. */
export function getSmsVerifier(request: Request, env: Env = process.env, fetchImpl: typeof fetch = fetch): SmsVerifier | null {
  const provider = env.WANEES_SMS_PROVIDER?.trim().toLowerCase();
  if (provider === "twilio") return createTwilioVerifier(env, fetchImpl);
  // Fixed codes: never in a production build, and only for requests addressed to this machine.
  if (provider === "test") return testSmsAllowed(env) && isLoopbackRequest(request.headers) ? createTestVerifier(env) : null;
  return null;
}
