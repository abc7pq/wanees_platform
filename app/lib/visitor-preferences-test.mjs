import assert from "node:assert/strict";
import { visitorPreferencesSchema } from "./api-contracts.ts";
import { buildBrowserVisitorPreferences } from "./visitor-preferences.ts";

const withoutOptionalText = buildBrowserVisitorPreferences({
  companions: "",
  mood: "  ",
  interests: ["طعام", "", "  ", "ألعاب"],
  budgetMaxCents: 10_000,
  availableMinutes: 120,
  optInPersist: true,
  startPointId: "",
});

assert.deepEqual(withoutOptionalText, {
  interests: ["طعام", "ألعاب"],
  budgetMaxCents: 10_000,
  availableMinutes: 120,
  optInPersist: true,
});
assert.equal(visitorPreferencesSchema.safeParse(withoutOptionalText).success, true);

const complete = buildBrowserVisitorPreferences({
  companions: " أصدقاء ",
  mood: " حماسي ",
  interests: [" ألعاب "],
  budgetMaxCents: null,
  availableMinutes: 180,
  optInPersist: true,
  startPointId: " entrance-main ",
});

assert.deepEqual(complete, {
  companions: "أصدقاء",
  mood: "حماسي",
  interests: ["ألعاب"],
  budgetMaxCents: null,
  availableMinutes: 180,
  optInPersist: true,
  startPointId: "entrance-main",
});
assert.equal(visitorPreferencesSchema.safeParse(complete).success, true);

console.log("browser visitor preference normalization passed");
