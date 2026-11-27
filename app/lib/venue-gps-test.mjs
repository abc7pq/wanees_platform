import assert from "node:assert/strict";
import { createVenueGeo, hasGeoCalibration, snapVenuePosition } from "./venue-gps.ts";
import { venueNavigation } from "../../packages/engine/src/db-catalog.ts";

const boulevard = { anchorLat: 24.7766539, anchorLng: 46.6003677, metersPerUnit: 0.62, rotationDeg: 0 };
const geo = createVenueGeo(boulevard);
const nodes = [
  { id: "closed", label: "مغلق", x: 10, y: 10, status: "closed" },
  { id: "entrance", label: "بوابة", x: 20, y: 20, status: "open" },
  { id: "kiosk", label: "استعلامات", x: 60, y: 20, status: "open" },
];
const [latitude, longitude] = geo.toLatLng(10, 10);
const fix = snapVenuePosition(geo, { latitude, longitude, accuracy: 8 }, nodes);
assert.equal(fix.status, "ready");
assert.equal(fix.node.id, "entrance", "closed nodes are never a start");
assert.equal(fix.approximate, false);
assert.ok(Math.abs(fix.point.x - 10) < 0.01);

// Crowds degrade GPS: up to 150 m is accepted as approximate with two candidate starts.
const crowded = snapVenuePosition(geo, { latitude, longitude, accuracy: 120 }, nodes);
assert.equal(crowded.status, "ready", "a 120 m fix is no longer rejected");
assert.equal(crowded.approximate, true);
assert.deepEqual(crowded.candidates.map((node) => node.id), ["entrance", "kiosk"]);
assert.equal(snapVenuePosition(geo, { latitude, longitude, accuracy: 151 }, nodes).status, "inaccurate");
assert.equal(snapVenuePosition(geo, { latitude: 24.5, longitude, accuracy: 3 }, nodes).status, "outside");
assert.equal(snapVenuePosition(geo, { latitude, longitude, accuracy: 3 }, []).status, "outside");

// Round trip and distances at any calibration, rotation included.
for (const calibration of [boulevard, { anchorLat: 21.4225, anchorLng: 39.8262, metersPerUnit: 1.5, rotationDeg: 30 }, { anchorLat: -33.86, anchorLng: 151.21, metersPerUnit: 0.25, rotationDeg: -90 }]) {
  const venue = createVenueGeo(calibration);
  const [lat, lng] = venue.toLatLng(219, -312);
  const back = venue.fromLatLng(lat, lng);
  assert.ok(Math.abs(back.x - 219) < 0.01 && Math.abs(back.y + 312) < 0.01, `round trip at ${calibration.anchorLat}`);
  assert.equal(venue.distanceMeters({ x: 0, y: 0 }, { x: 3, y: 4 }), 5 * calibration.metersPerUnit);
}
// A plan rotated 90° clockwise: plan north points to true east.
const rotated = createVenueGeo({ ...boulevard, rotationDeg: 90 });
const [northLat, northLng] = rotated.toLatLng(0, -100);
assert.ok(Math.abs(northLat - boulevard.anchorLat) < 1e-6 && northLng > boulevard.anchorLng, "plan north maps to true east");
assert.equal(rotated.compassBearing(0), 90);
assert.equal(rotated.compassBearing(300), 30);

// Navigation settings come from the venue row alone; no event slug is special.
assert.equal(hasGeoCalibration(null), false);
assert.equal(hasGeoCalibration({ calibration: boulevard }), true);
assert.equal(hasGeoCalibration({ calibration: { ...boulevard, metersPerUnit: 0 } }), false);
const live = venueNavigation({ geoAnchorLat: 24.7, geoAnchorLng: 46.6, metersPerUnit: 0.62, rotationDeg: 0, liveGuidance: true, navigationAccuracy: "APPROXIMATE", gpsSimulation: true });
assert.deepEqual(live, { liveGuidance: true, accuracy: "approximate", simulation: true, calibration: { anchorLat: 24.7, anchorLng: 46.6, metersPerUnit: 0.62, rotationDeg: 0 } });
const uncalibrated = venueNavigation({ geoAnchorLat: null, geoAnchorLng: null, metersPerUnit: null, rotationDeg: 0, liveGuidance: true, navigationAccuracy: "SURVEYED", gpsSimulation: true });
assert.equal(uncalibrated.liveGuidance, false, "live guidance needs a calibration");
assert.equal(uncalibrated.simulation, false);
assert.equal(uncalibrated.accuracy, "surveyed");
assert.equal(venueNavigation(null).liveGuidance, false, "an event without a venue has no GPS");
console.log("venue GPS: per-venue calibration, rotation, approximate fixes and navigation settings passed");
