import assert from "node:assert/strict";
import { snapVenuePosition, supportsVenueGps, toLatLng } from "./venue-gps.ts";

const nodes = [
  { id: "closed", label: "مغلق", x: 10, y: 10, status: "closed" },
  { id: "entrance", label: "بوابة", x: 20, y: 20, status: "open" },
];
const [latitude, longitude] = toLatLng(10, 10);
const fix = snapVenuePosition({ latitude, longitude, accuracy: 8 }, nodes);
assert.equal(fix.status, "ready");
assert.equal(fix.node.id, "entrance");
assert.ok(Math.abs(fix.point.x - 10) < 0.01);
assert.equal(snapVenuePosition({ latitude, longitude, accuracy: 400 }, nodes).status, "inaccurate");
assert.equal(snapVenuePosition({ latitude: 24.5, longitude, accuracy: 3 }, nodes).status, "outside");
assert.equal(snapVenuePosition({ latitude, longitude, accuracy: 3 }, []).status, "outside");
assert.equal(supportsVenueGps("boulevard-world-demo"), true);
assert.equal(supportsVenueGps("sample-festival"), false);
console.log("venue GPS calibration, accuracy and open-node tests passed");
