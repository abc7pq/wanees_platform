// Activity content review (audit item 1.3). Tags are suggested from the activity's own words with
// the controlled lexicon; a suggestion joins the published tags only when an organizer approves it.
import { isKnownTag, tagsInText } from "../../packages/engine/src/tags.ts";

export function suggestActivityTags(activity: { nameAr: string; nameEn?: string | null; descriptionAr?: string | null; tags: readonly string[] }) {
  const text = [activity.nameAr, activity.nameEn, activity.descriptionAr].filter(Boolean).join(" ");
  return tagsInText(text).filter((tag) => !activity.tags.includes(tag)).slice(0, 10);
}

/** Moves approved suggestions into tags and drops rejected ones. Unknown or unsuggested tags are ignored. */
export function reviewTagSuggestions(current: { tags: readonly string[]; suggestions: readonly string[] }, approve: readonly string[], reject: readonly string[]) {
  const approved = approve.filter((tag) => current.suggestions.includes(tag) && isKnownTag(tag));
  const tags = [...new Set([...current.tags, ...approved])].slice(0, 20);
  const suggestions = current.suggestions.filter((tag) => !approved.includes(tag) && !reject.includes(tag) && !tags.includes(tag));
  return { tags, suggestions };
}
