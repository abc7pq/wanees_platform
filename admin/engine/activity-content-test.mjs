import assert from "node:assert/strict";
import { reviewTagSuggestions, suggestActivityTags } from "../lib/activity-content.ts";
import { activityContentIssues, parseActivityTags } from "../../packages/engine/src/content-rules.ts";

// Suggestions come from the activity's own words and skip tags it already has.
assert.deepEqual(suggestActivityTags({ nameAr: "عرض الطيور الجارحة", descriptionAr: "عرض حي للحيوانات", tags: ["عروض"] }), ["حيوانات"]);
assert.deepEqual(suggestActivityTags({ nameAr: "Drift Arena", nameEn: "Drift racing cars", tags: [] }), ["سيارات"]);

// Only an organizer's approval moves a suggestion into tags; unsuggested or unknown tags are ignored.
const reviewed = reviewTagSuggestions({ tags: ["عروض"], suggestions: ["حيوانات", "أطفال"] }, ["حيوانات", "رعب", "غير معروف"], ["أطفال"]);
assert.deepEqual(reviewed, { tags: ["عروض", "حيوانات"], suggestions: [] });

// Publishing needs a description and three controlled tags.
assert.deepEqual(activityContentIssues({ stableKey: "a", descriptionAr: "وصف", tags: ["عروض", "أطفال", "هدوء"] }), []);
assert.deepEqual(activityContentIssues({ stableKey: "a", descriptionAr: " ", tags: ["عروض"] }).map((issue) => issue.code), ["ACTIVITY_DESCRIPTION_REQUIRED", "ACTIVITY_TAGS_REQUIRED"]);
assert.deepEqual(activityContentIssues({ stableKey: "a", descriptionAr: "وصف", tags: ["عروض", "أطفال", "شي"] }).map((issue) => issue.code), ["ACTIVITY_TAG_UNKNOWN", "ACTIVITY_TAGS_REQUIRED"]);
assert.deepEqual(activityContentIssues({ stableKey: "a", status: "TEMPORARILY_CLOSED", tags: [] }), []);
assert.deepEqual(parseActivityTags([" عروض ", "عروض", "أطفال"]), { ok: true, tags: ["عروض", "أطفال"] });
assert.deepEqual(parseActivityTags(["عروض", "xyz"]), { ok: false, unknown: ["xyz"] });
assert.deepEqual(parseActivityTags("عروض"), { ok: false, unknown: [] });
console.log("activity content: all assertions passed");
