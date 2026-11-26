// The catalog crosswalk gate: the one place that decides whether a catalog
// version may go live (publish) or be made live again (rollback).
// The database holds the same rule with a CHECK constraint and triggers
// (migration 20261125200000_catalog_crosswalk_gate), so scripts and raw SQL
// cannot get around it either. Only scripts/catalog-crosswalk-verify.ts sets VERIFIED.

export type CrosswalkStatus = "NOT_REQUIRED" | "HOLD" | "VERIFIED";
export type CrosswalkState = { crosswalkStatus: CrosswalkStatus; crosswalkChecksum: string | null };
export type CrosswalkRefusal = {
  code: "CROSSWALK_HOLD" | "CROSSWALK_CHECKSUM_REQUIRED" | "CROSSWALK_CHECKSUM_MISMATCH";
  message: string;
};

export const CROSSWALK_CHECKSUM = /^[0-9a-f]{64}$/;

/**
 * Why `version` may not go live, or null when it may.
 * `presentedChecksum` is the crosswalk SHA-256 the publisher is acting on. For a
 * VERIFIED version it must equal the stored one, so a version re-verified
 * against a different artifact since the publisher loaded it is refused.
 */
export function crosswalkRefusal(version: CrosswalkState, presentedChecksum: unknown): CrosswalkRefusal | null {
  if (version.crosswalkStatus === "NOT_REQUIRED") return null;
  if (version.crosswalkStatus !== "VERIFIED" || !version.crosswalkChecksum || !CROSSWALK_CHECKSUM.test(version.crosswalkChecksum)) {
    return { code: "CROSSWALK_HOLD", message: "مطابقة الكتالوج (crosswalk) لم تُعتمد بعد؛ النسخة موقوفة على HOLD." };
  }
  if (typeof presentedChecksum !== "string" || !presentedChecksum) {
    return { code: "CROSSWALK_CHECKSUM_REQUIRED", message: "أرسل crosswalkChecksum للنسخة المعتمدة التي تنشرها." };
  }
  if (presentedChecksum.toLowerCase() !== version.crosswalkChecksum) {
    return { code: "CROSSWALK_CHECKSUM_MISMATCH", message: "بصمة المطابقة المرسلة لا تطابق البصمة المعتمدة لهذه النسخة." };
  }
  return null;
}

/** Prisma `where` fragment that repeats the gate inside the write itself, so a concurrent edit loses the race. */
export function crosswalkWhere(version: CrosswalkState) {
  return version.crosswalkStatus === "NOT_REQUIRED"
    ? { crosswalkStatus: "NOT_REQUIRED" as const }
    : { crosswalkStatus: "VERIFIED" as const, crosswalkChecksum: version.crosswalkChecksum };
}

/** Validation error for a draft whose crosswalk is not approved yet, or null. */
export function crosswalkValidationError(version: CrosswalkState) {
  return version.crosswalkStatus === "HOLD"
    ? { code: "CROSSWALK_HOLD", message: "مطابقة الكتالوج (crosswalk) بانتظار الاعتماد؛ لا يمكن نشر هذه النسخة قبلها." }
    : null;
}

/** True when a write was refused by the database's crosswalk triggers (a race the app check lost). */
export function isCrosswalkDatabaseRefusal(error: unknown) {
  return error instanceof Error && /CROSSWALK_(HOLD|NOT_REQUIRED_FORBIDDEN)/.test(error.message);
}
