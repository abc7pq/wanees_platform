// Local/CI verifier: sends nothing and accepts only WANEES_TEST_OTP_CODE.
// getSmsVerifier() hands it out only for loopback requests, so it never works behind the public proxy.
import type { SmsVerifier } from "./index.ts";

type Env = Record<string, string | undefined>;

export function createTestVerifier(env: Env): SmsVerifier | null {
  const expected = env.WANEES_TEST_OTP_CODE?.trim();
  if (!expected || !/^\d{6}$/.test(expected)) return null;
  return {
    provider: "test",
    async start() {
      return { ok: true };
    },
    async check(_phone, code) {
      return code === expected ? "approved" : "invalid";
    },
  };
}
