import assert from "node:assert/strict";
import { crosswalkRefusal, crosswalkValidationError, crosswalkWhere, isCrosswalkDatabaseRefusal } from "../lib/catalog-crosswalk-gate.ts";

const sha = "b".repeat(64);
const verified = { crosswalkStatus: "VERIFIED", crosswalkChecksum: sha };

// Catalogs published before the gate stay publishable and restorable.
assert.equal(crosswalkRefusal({ crosswalkStatus: "NOT_REQUIRED", crosswalkChecksum: null }, undefined), null);
// HOLD is refused whatever checksum is presented.
assert.equal(crosswalkRefusal({ crosswalkStatus: "HOLD", crosswalkChecksum: null }, sha)?.code, "CROSSWALK_HOLD");
// VERIFIED with a missing or malformed stored checksum is treated as HOLD.
assert.equal(crosswalkRefusal({ crosswalkStatus: "VERIFIED", crosswalkChecksum: null }, sha)?.code, "CROSSWALK_HOLD");
assert.equal(crosswalkRefusal({ crosswalkStatus: "VERIFIED", crosswalkChecksum: "abc" }, "abc")?.code, "CROSSWALK_HOLD");
// VERIFIED needs the publisher to present the approved checksum.
assert.equal(crosswalkRefusal(verified, undefined)?.code, "CROSSWALK_CHECKSUM_REQUIRED");
assert.equal(crosswalkRefusal(verified, "")?.code, "CROSSWALK_CHECKSUM_REQUIRED");
assert.equal(crosswalkRefusal(verified, "c".repeat(64))?.code, "CROSSWALK_CHECKSUM_MISMATCH");
assert.equal(crosswalkRefusal(verified, sha), null);
assert.equal(crosswalkRefusal(verified, sha.toUpperCase()), null);

assert.deepEqual(crosswalkWhere(verified), { crosswalkStatus: "VERIFIED", crosswalkChecksum: sha });
assert.deepEqual(crosswalkWhere({ crosswalkStatus: "NOT_REQUIRED", crosswalkChecksum: null }), { crosswalkStatus: "NOT_REQUIRED" });
assert.equal(crosswalkValidationError({ crosswalkStatus: "HOLD", crosswalkChecksum: null })?.code, "CROSSWALK_HOLD");
assert.equal(crosswalkValidationError(verified), null);
assert.equal(isCrosswalkDatabaseRefusal(new Error("ERROR: CROSSWALK_HOLD: catalog version x")), true);
assert.equal(isCrosswalkDatabaseRefusal(new Error("unique constraint")), false);

console.log("crosswalk gate rules passed");
