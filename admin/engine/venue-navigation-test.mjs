import assert from "node:assert/strict";
import { validateNavigationPatch } from "../lib/venue-navigation.ts";

const uncalibrated = { liveGuidance: false, navigationAccuracy: "APPROXIMATE", gpsSimulation: false, geoAnchorLat: null, geoAnchorLng: null, metersPerUnit: null, rotationDeg: 0 };
const calibrated = { ...uncalibrated, geoAnchorLat: 24.7766539, geoAnchorLng: 46.6003677, metersPerUnit: 0.62 };

// Live guidance and simulation need a calibration.
assert.equal(validateNavigationPatch(uncalibrated, { liveGuidance: true }).ok, false);
assert.equal(validateNavigationPatch(uncalibrated, { gpsSimulation: true }).ok, false);
const on = validateNavigationPatch(calibrated, { liveGuidance: true, reason: "field walk done" });
assert.equal(on.ok, true);
assert.deepEqual(on.changed, ["liveGuidance"]);

// A calibration and live guidance can be set in one request.
const both = validateNavigationPatch(uncalibrated, { geoAnchorLat: "21.4225", geoAnchorLng: 39.8262, metersPerUnit: 1.5, rotationDeg: 30, liveGuidance: true });
assert.equal(both.ok, true);
assert.equal(both.settings.geoAnchorLat, 21.4225, "numeric strings from form fields are accepted");
assert.deepEqual(both.changed, ["liveGuidance", "geoAnchorLat", "geoAnchorLng", "metersPerUnit", "rotationDeg"]);

// A calibration is all or nothing, and clearing it while live guidance is on is refused.
assert.equal(validateNavigationPatch(uncalibrated, { geoAnchorLat: 24.7 }).ok, false);
assert.equal(validateNavigationPatch({ ...calibrated, liveGuidance: true }, { geoAnchorLat: null, geoAnchorLng: null, metersPerUnit: null }).ok, false);
const cleared = validateNavigationPatch(calibrated, { geoAnchorLat: null, geoAnchorLng: null, metersPerUnit: null });
assert.equal(cleared.ok, true);

// Ranges match the database CHECK constraints.
assert.equal(validateNavigationPatch(calibrated, { geoAnchorLat: 91 }).ok, false);
assert.equal(validateNavigationPatch(calibrated, { geoAnchorLng: -181 }).ok, false);
assert.equal(validateNavigationPatch(calibrated, { metersPerUnit: 0 }).ok, false);
assert.equal(validateNavigationPatch(calibrated, { metersPerUnit: 101 }).ok, false);
assert.equal(validateNavigationPatch(calibrated, { rotationDeg: 181 }).ok, false);
assert.equal(validateNavigationPatch(calibrated, { rotationDeg: null }).ok, false);
assert.equal(validateNavigationPatch(calibrated, { navigationAccuracy: "EXACT" }).ok, false);
assert.equal(validateNavigationPatch(calibrated, { liveGuidance: "yes" }).ok, false);
assert.equal(validateNavigationPatch(calibrated, { geoAnchorLat: "north" }).ok, false);

// Unknown fields and bad bodies are refused; an empty change is allowed and reports no changes.
assert.equal(validateNavigationPatch(calibrated, { venueId: "x" }).ok, false);
assert.equal(validateNavigationPatch(calibrated, null).ok, false);
assert.equal(validateNavigationPatch(calibrated, []).ok, false);
assert.deepEqual(validateNavigationPatch(calibrated, {}).changed, []);

console.log("venue navigation settings: calibration, live guidance and simulation rules passed");
