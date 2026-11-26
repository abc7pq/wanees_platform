// Registered visitors names and phone numbers are personal data: Owner and Admin only.
export const VISITOR_PII_ROLES = ["OWNER", "ADMIN"] as const;

export function canSeeVisitorPii(role: string | null | undefined) {
  return (VISITOR_PII_ROLES as readonly string[]).includes(role ?? "");
}

/** Phone numbers are masked by default (country code and last two digits kept), e.g. +966•••••••34. */
export function maskPhone(phone: string | null | undefined) {
  if (!phone) return "";
  const tail = phone.slice(-2);
  const head = phone.startsWith("+") ? phone.slice(0, Math.min(4, Math.max(0, phone.length - 2))) : "";
  return `${head}${"•".repeat(Math.max(0, phone.length - head.length - tail.length))}${tail}`;
}

/** True when the request explicitly asks to reveal unmasked phone numbers. */
export function wantsPhoneReveal(request: Request) {
  return new URL(request.url).searchParams.get("reveal") === "phone";
}
