// Content rules for a published activity (audit item 1.3). Used by the organizer's validation
// (publish refuses a version that breaks them) and by the catalog build script (`--check` fails).
import { isKnownTag } from "./tags.ts";

export const MIN_ACTIVITY_TAGS = 3;
export const MAX_ACTIVITY_TAGS = 20;

export type ContentIssue = { code: "ACTIVITY_DESCRIPTION_REQUIRED" | "ACTIVITY_TAGS_REQUIRED" | "ACTIVITY_TAG_UNKNOWN"; message: string; entity: string };

export function activityContentIssues(activity: { stableKey: string; status?: string; descriptionAr?: string | null; tags?: readonly string[] | null }): ContentIssue[] {
  if (activity.status && activity.status !== "ACTIVE") return [];
  const issues: ContentIssue[] = [];
  const tags = activity.tags ?? [];
  if (!activity.descriptionAr?.trim()) {
    issues.push({ code: "ACTIVITY_DESCRIPTION_REQUIRED", message: "النشاط يحتاج وصفًا بالعربي قبل النشر.", entity: activity.stableKey });
  }
  const unknown = tags.filter((tag) => !isKnownTag(tag));
  if (unknown.length) {
    issues.push({ code: "ACTIVITY_TAG_UNKNOWN", message: `وسوم خارج القائمة المعتمدة: ${unknown.join("، ")}.`, entity: activity.stableKey });
  }
  if (tags.filter(isKnownTag).length < MIN_ACTIVITY_TAGS) {
    issues.push({ code: "ACTIVITY_TAGS_REQUIRED", message: `النشاط يحتاج ${MIN_ACTIVITY_TAGS} وسوم معتمدة على الأقل قبل النشر.`, entity: activity.stableKey });
  }
  return issues;
}

/**
 * Validates an organizer's tag list: trims, removes duplicates, and refuses tags outside the
 * controlled vocabulary. Returns the clean list or the unknown tags.
 */
export function parseActivityTags(input: unknown): { ok: true; tags: string[] } | { ok: false; unknown: string[] } {
  if (!Array.isArray(input) || !input.every((item) => typeof item === "string")) return { ok: false, unknown: [] };
  const tags = [...new Set(input.map((item) => item.trim()).filter(Boolean))].slice(0, MAX_ACTIVITY_TAGS);
  const unknown = tags.filter((tag) => !isKnownTag(tag));
  return unknown.length ? { ok: false, unknown } : { ok: true, tags };
}
