import assert from "node:assert/strict";
import { normalizeCatalogRows, parseCsv } from "./catalog-csv.ts";

const rows = parseCsv(`id,name_en,name_ar,zone,type,category,audience,min_age,duration_min,price_sar,note,new_2026\nalpha,Alpha,ألفا,Zone A,attraction,thrill,"family,kids",6,20,40,"ملاحظة، فيها فاصلة",true\nbeta,Beta,بيتا,Zone A,food,food,all,0,15,0,,false`);
assert.equal(rows.length, 2);
assert.equal(rows[0].note, "ملاحظة، فيها فاصلة");
const normalized = normalizeCatalogRows(rows);
assert.equal(normalized.errors.length, 0);
assert.equal(normalized.activities.length, 2);
assert.equal(normalized.zones.length, 1);
assert.equal(normalized.activities[0].familyFriendly, true);
assert.equal(normalized.activities[0].interests.includes("new-2026"), true);
assert.equal(normalized.summary.pricedCandidates, 1);
assert.equal(normalized.summary.freeCandidates, 1);
console.log("catalog CSV parser and normalization passed");
