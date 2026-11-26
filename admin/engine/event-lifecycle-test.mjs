import assert from "node:assert/strict";
import {
  checkEventTransition,
  EVENT_STATUSES,
  EVENT_STATUS_TRANSITIONS,
  isEventStatus,
  nextEventActions,
  requiresConfirmation,
  VISITOR_VISIBLE_STATUSES,
} from "../lib/event-lifecycle.ts";

const withCatalog = { hasPublishedCatalog: true };
const noCatalog = { hasPublishedCatalog: false };

// The table is exactly the documented one.
assert.deepEqual(EVENT_STATUS_TRANSITIONS, {
  DRAFT: ["PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["LIVE", "DRAFT", "ARCHIVED"],
  LIVE: ["COMPLETED"],
  COMPLETED: ["ARCHIVED"],
  ARCHIVED: ["DRAFT"],
});
assert.deepEqual([...VISITOR_VISIBLE_STATUSES], ["PUBLISHED", "LIVE"]);

// Every pair: allowed exactly when it is in the table (catalog present, confirmed).
for (const from of EVENT_STATUSES) {
  for (const to of EVENT_STATUSES) {
    const refusal = checkEventTransition(from, to, withCatalog, true);
    if (EVENT_STATUS_TRANSITIONS[from].includes(to)) assert.equal(refusal, null, `${from}→${to} should be allowed`);
    else assert.equal(refusal?.code, "EVENT_TRANSITION_NOT_ALLOWED", `${from}→${to} should be refused`);
  }
}

// No self transitions, archived never goes straight back to visitors, live cannot be archived directly.
assert.equal(checkEventTransition("DRAFT", "DRAFT", withCatalog, true)?.code, "EVENT_TRANSITION_NOT_ALLOWED");
assert.equal(checkEventTransition("ARCHIVED", "PUBLISHED", withCatalog, true)?.code, "EVENT_TRANSITION_NOT_ALLOWED");
assert.equal(checkEventTransition("ARCHIVED", "LIVE", withCatalog, true)?.code, "EVENT_TRANSITION_NOT_ALLOWED");
assert.equal(checkEventTransition("LIVE", "ARCHIVED", withCatalog, true)?.code, "EVENT_TRANSITION_NOT_ALLOWED");
assert.equal(checkEventTransition("COMPLETED", "LIVE", withCatalog, true)?.code, "EVENT_TRANSITION_NOT_ALLOWED");

// Visitor-facing targets need a published catalog version.
assert.equal(checkEventTransition("DRAFT", "PUBLISHED", noCatalog, true)?.code, "CATALOG_NOT_PUBLISHED");
assert.equal(checkEventTransition("PUBLISHED", "LIVE", noCatalog, true)?.code, "CATALOG_NOT_PUBLISHED");
assert.equal(checkEventTransition("DRAFT", "ARCHIVED", noCatalog, true), null);
assert.equal(checkEventTransition("ARCHIVED", "DRAFT", noCatalog, false), null);

// Archive and finish need an explicit confirmation; the others do not.
assert.equal(requiresConfirmation("ARCHIVED"), true);
assert.equal(requiresConfirmation("COMPLETED"), true);
assert.equal(requiresConfirmation("PUBLISHED"), false);
assert.equal(checkEventTransition("COMPLETED", "ARCHIVED", withCatalog, false)?.code, "CONFIRMATION_REQUIRED");
assert.equal(checkEventTransition("LIVE", "COMPLETED", withCatalog, false)?.code, "CONFIRMATION_REQUIRED");
assert.equal(checkEventTransition("DRAFT", "PUBLISHED", withCatalog, false), null);

// Unknown input is rejected, not coerced.
assert.equal(isEventStatus("draft"), false);
assert.equal(isEventStatus(undefined), false);
assert.equal(checkEventTransition("DRAFT", "DELETED", withCatalog, true)?.code, "EVENT_STATUS_INVALID");
assert.equal(checkEventTransition(42, "DRAFT", withCatalog, true)?.code, "EVENT_STATUS_INVALID");

// Dashboard actions: Arabic labels, confirmation flags and the blocked reason.
const draftActions = nextEventActions("DRAFT", noCatalog);
assert.deepEqual(draftActions.map((action) => action.to), ["PUBLISHED", "ARCHIVED"]);
assert.equal(draftActions[0].label, "نشر للزوار");
assert.match(draftActions[0].blockedReason ?? "", /الكتالوج/);
assert.equal(draftActions[1].requiresConfirmation, true);
assert.equal(draftActions[1].blockedReason, null);
assert.equal(nextEventActions("ARCHIVED", noCatalog)[0].label, "استعادة كمسودة");
assert.equal(nextEventActions("PUBLISHED", withCatalog).find((action) => action.to === "DRAFT")?.label, "إلغاء النشر");
assert.deepEqual(nextEventActions("UNKNOWN", withCatalog), []);

console.log("event lifecycle: transition table and guards ok");
