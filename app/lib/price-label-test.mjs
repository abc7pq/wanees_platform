import assert from "node:assert/strict";
import { FREE_LABEL, forParty, stopPriceLabel } from "./price-label.ts";

// Every paid stop is labelled per person; a lone visitor sees no group line.
assert.deepEqual(stopPriceLabel(40, 1), { perPerson: "40 ريال للشخص", group: null });
assert.deepEqual(stopPriceLabel(40), { perPerson: "40 ريال للشخص", group: null });
assert.deepEqual(stopPriceLabel(40, null), { perPerson: "40 ريال للشخص", group: null });

// A group also sees what the stop costs the whole party, with Arabic number agreement and Western digits.
assert.deepEqual(stopPriceLabel(40, 2), { perPerson: "40 ريال للشخص", group: "80 ريال لشخصين" });
assert.deepEqual(stopPriceLabel(65, 3), { perPerson: "65 ريال للشخص", group: "195 ريال لـ3 أشخاص" });
assert.deepEqual(stopPriceLabel(50, 12), { perPerson: "50 ريال للشخص", group: "600 ريال لـ12 شخصًا" });

// Free stops keep the free label and never show a group total.
assert.deepEqual(stopPriceLabel(0, 4), { perPerson: FREE_LABEL, group: null });
assert.deepEqual(stopPriceLabel(Number.NaN, 4), { perPerson: FREE_LABEL, group: null });

// A party size the server did not give sensibly falls back to per person only.
assert.deepEqual(stopPriceLabel(40, 0), { perPerson: "40 ريال للشخص", group: null });
assert.deepEqual(stopPriceLabel(40, 2.5), { perPerson: "40 ريال للشخص", group: null });
assert.deepEqual(stopPriceLabel(40, 500), { perPerson: "40 ريال للشخص", group: null });

assert.equal(forParty(2), "لشخصين");
assert.equal(forParty(5), "لـ5 أشخاص");
assert.ok(!/[٠-٩]/.test(stopPriceLabel(40, 3).group ?? ""), "Western digits only");

console.log("price-label tests passed");
