// هوية الزائر المسجّل: تنسيق رقم الجوال، تنظيف الاسم، وكوكي "تذكّر هذا الجهاز".
// وحدة خالية من قاعدة البيانات حتى تُختبر مباشرة. التخزين في visitor-store.ts.
import { createHash, createHmac, randomBytes } from "node:crypto";

export const VISITOR_DEVICE_COOKIE = "wanees_visitor";
export const VISITOR_DEVICE_TTL_SECONDS = 90 * 24 * 60 * 60;
/** Lifetime of a device when the visitor unticks «تذكّر هذا الجهاز». */
export const SHORT_DEVICE_TTL_SECONDS = 24 * 60 * 60;
export const OTP_CHALLENGE_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const MAX_DEVICES_PER_VISITOR = 10;

const DIGIT_MAP: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

/** Converts Arabic-Indic and Persian digits to ASCII. */
export function toAsciiDigits(value: string) {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => DIGIT_MAP[digit] ?? digit);
}

/**
 * Normalizes a Saudi mobile number to E.164 (+9665XXXXXXXX).
 * Accepts 05XXXXXXXX, 5XXXXXXXX, +9665XXXXXXXX, 9665XXXXXXXX and 009665XXXXXXXX,
 * with spaces, dashes, dots or parentheses, in Arabic or ASCII digits. Returns null otherwise.
 */
export function normalizeSaudiMobile(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const compact = toAsciiDigits(input).trim().replace(/[\s\-().]/g, "");
  if (compact.length > 16) return null;
  const match = compact.match(/^(?:\+966|00966|966|0)?(5\d{8})$/);
  return match ? `+966${match[1]}` : null;
}

/** "+966512345678" → "+9665•••••678". Safe for logs, UI and audit summaries. */
export function maskPhone(e164: string) {
  if (!/^\+\d{8,15}$/.test(e164)) return "•••";
  return `${e164.slice(0, 5)}•••••${e164.slice(-3)}`;
}

/**
 * Cleans a visitor-entered name: trims, collapses spaces, allows Arabic and Latin letters,
 * spaces, hyphens, apostrophes and dots. 2–60 characters, no digits, URLs or symbols.
 */
export function cleanVisitorName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const name = input.normalize("NFC").replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 60) return null;
  if (!/^[\p{Script=Arabic}\p{Script=Latin}\p{M}\s'’.\-]+$/u.test(name)) return null;
  if (/\p{Nd}/u.test(name)) return null;
  return name;
}

export function createDeviceToken() {
  return randomBytes(32).toString("base64url");
}

export function hashDeviceToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Per-phone rate-limit scope without putting the number itself in the key. */
export function phoneScope(prefix: string, e164: string, secret = process.env.WANEES_RATE_LIMIT_SALT ?? "wanees-development-rate-salt") {
  // Keyed hash: an unsalted SHA-256 of ~10^8 Saudi mobiles can be reversed in seconds.
  return `${prefix}:${createHmac("sha256", secret).update(`wanees-phone:${e164}`).digest("hex").slice(0, 24)}`;
}

/** SMS send budget per phone and organization, counted from stored challenges (not per IP). */
export const OTP_RESEND_SECONDS = 60;
export const OTP_SENDS_PER_10_MIN = 3;
export const OTP_SENDS_PER_DAY = 10;

/**
 * Decides whether another code may be sent, given the creation times of this phone's
 * challenges in the last 24 hours. Pure, so the limits are unit-tested without a database.
 */
export function otpSendBudget(createdAt: Date[], now = new Date()): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  const t = now.getTime();
  const times = createdAt.map((date) => date.getTime()).filter((time) => time > t - 24 * 3600_000).sort((a, b) => b - a);
  const wait = (until: number) => ({ allowed: false as const, retryAfterSeconds: Math.max(1, Math.ceil((until - t) / 1000)) });
  if (times[0] !== undefined && t - times[0] < OTP_RESEND_SECONDS * 1000) return wait(times[0] + OTP_RESEND_SECONDS * 1000);
  const recent = times.filter((time) => time > t - 10 * 60_000);
  if (recent.length >= OTP_SENDS_PER_10_MIN) return wait(recent[OTP_SENDS_PER_10_MIN - 1] + 10 * 60_000);
  if (times.length >= OTP_SENDS_PER_DAY) return wait(times[OTP_SENDS_PER_DAY - 1] + 24 * 3600_000);
  return { allowed: true };
}

/**
 * Login-CSRF guard for the visitor identity routes. A browser marks cross-site requests with
 * Sec-Fetch-Site and Origin; a form post can't send application/json without a preflight.
 * Native clients send neither Origin nor Sec-Fetch-Site and pass.
 */
export function isCrossSiteRequest(headers: Pick<Headers, "get">, requestUrl: string, requireJson = true) {
  if (headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") return true;
  const origin = headers.get("origin");
  if (origin) {
    const proto = headers.get("x-forwarded-proto") ?? new URL(requestUrl).protocol.replace(":", "");
    const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? new URL(requestUrl).host;
    if (origin.toLowerCase() !== `${proto}://${host}`.toLowerCase()) return true;
  }
  if (requireJson && !/^application\/json\b/i.test(headers.get("content-type") ?? "")) return true;
  return false;
}

/**
 * The fixed-code test provider works in development, and in a production build (CI runs
 * `next start`) only with an explicit WANEES_ALLOW_TEST_SMS=true. A real deployment sets neither.
 */
export function testSmsAllowed(env: Record<string, string | undefined>) {
  return env.NODE_ENV !== "production" || env.WANEES_ALLOW_TEST_SMS === "true";
}

export function readDeviceToken(request: Request) {
  const header = request.headers.get("x-wanees-visitor-token");
  if (header?.trim()) return header.trim();
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${VISITOR_DEVICE_COOKIE}=([^;]+)`));
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

const secureFlag = () => (process.env.NODE_ENV === "production" ? "; Secure" : "");

export function setDeviceCookie(response: Response, token: string, maxAgeSeconds = VISITOR_DEVICE_TTL_SECONDS) {
  response.headers.append(
    "Set-Cookie",
    `${VISITOR_DEVICE_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secureFlag()}`,
  );
  return response;
}

export function clearDeviceCookie(response: Response) {
  response.headers.append("Set-Cookie", `${VISITOR_DEVICE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag()}`);
  return response;
}

/**
 * The test SMS provider is only honoured for requests addressed to this machine
 * (localhost, 127.0.0.1 or [::1]) with no different forwarded host. Production traffic
 * arrives through the proxy with the public hostname, so it can never use fixed codes.
 */
export function isLoopbackRequest(headers: Pick<Headers, "get">) {
  const host = headers.get("host")?.toLowerCase();
  const forwarded = headers.get("x-forwarded-host")?.toLowerCase();
  return Boolean(host && /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)
    && (forwarded === undefined || forwarded === host));
}
