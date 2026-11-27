import assert from "node:assert/strict";
import { visitorPreferencesSchema } from "./api-contracts.ts";
import { buildBrowserVisitorPreferences, preferencesFromSnapshot } from "./visitor-preferences.ts";

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

// «نفس الجو» (audit 4.1): a remembered snapshot becomes valid session preferences.
const fromSnapshot = preferencesFromSnapshot({ companions: "family", partySize: 4, youngestChildAge: 6, mood: "", interests: ["ألعاب", 7], budgetMaxCents: 30000, junk: true });
assert.deepEqual(fromSnapshot, { companions: "family", partySize: 4, youngestChildAge: 6, interests: ["ألعاب"], budgetMaxCents: 30000, availableMinutes: 180, optInPersist: false });
assert.equal(visitorPreferencesSchema.safeParse(fromSnapshot).success, true);
assert.equal(visitorPreferencesSchema.safeParse(preferencesFromSnapshot(null)).success, true);
assert.equal(preferencesFromSnapshot({ partySize: 99, availableMinutes: 5 }).partySize, 20);

console.log("browser visitor preference normalization passed");
