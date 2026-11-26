// Phone ↔ screen link (audit 4.3). The visitor's phone shows a short code and a QR for 10 minutes; a
// kiosk that redeems it once may read that visit's plan for one conversation. The grant is read-only,
// ends after 60 seconds without use, on «انتهيت», or when the visitor revokes it from the phone.
// The code is stored hashed with the event id, so a database read does not reveal live codes.
import { createHash, randomInt } from "node:crypto";

/** No 0/O, 1/I/L: the code is read off a phone screen and typed on a kiosk. */
export const LINK_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const LINK_CODE_LENGTH = 6;
export const LINK_CODE_TTL_MS = 10 * 60_000;
export const LINK_IDLE_MS = 60_000;
export const LINK_SCOPE = "read" as const;

export function createLinkCode(random: (max: number) => number = randomInt) {
  let code = "";
  for (let index = 0; index < LINK_CODE_LENGTH; index += 1) code += LINK_CODE_ALPHABET[random(LINK_CODE_ALPHABET.length)];
  return code;
}

const ARABIC_DIGITS: Record<string, string> = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9" };

/** What a person typed («ab3 k7q», «AB3-K7Q», Arabic digits) as a code, or null when it cannot be one. */
export function normalizeLinkCode(input: unknown) {
  if (typeof input !== "string" || input.length > 32) return null;
  const code = input
    .replace(/[٠-٩]/g, (digit) => ARABIC_DIGITS[digit] ?? digit)
    .replace(/[\s-]/g, "")
    .toUpperCase();
  if (code.length !== LINK_CODE_LENGTH) return null;
  for (const char of code) if (!LINK_CODE_ALPHABET.includes(char)) return null;
  return code;
}

export function hashLinkCode(eventId: string, code: string) {
  return createHash("sha256").update(`${eventId}:${code}`, "utf8").digest("hex");
}

export type LinkGrantTimes = {
  expiresAt: Date;
  redeemedAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

export type LinkGrantState = "pending" | "expired" | "active" | "idle" | "revoked";

/** One rule for the phone, the kiosk and the tests. */
export function linkGrantState(grant: LinkGrantTimes, now: Date = new Date()): LinkGrantState {
  if (grant.revokedAt) return "revoked";
  if (!grant.redeemedAt) return grant.expiresAt.getTime() > now.getTime() ? "pending" : "expired";
  const lastUse = (grant.lastUsedAt ?? grant.redeemedAt).getTime();
  return now.getTime() - lastUse > LINK_IDLE_MS ? "idle" : "active";
}

/** The link's address a phone camera opens on the kiosk; the code travels in the fragment, never to a server log. */
export function linkCodeUrl(origin: string, eventSlug: string, code: string) {
  return `${origin.replace(/\/$/, "")}/kiosk/${encodeURIComponent(eventSlug)}#code=${code}`;
}
