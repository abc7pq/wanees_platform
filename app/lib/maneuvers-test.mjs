import assert from "node:assert/strict";
import { buildManeuvers, classifyTurn, describeManeuver, distanceAlongPath, distanceFromPath, nextManeuver, roundMeters, turnDelta, bearingDegrees } from "./maneuvers.ts";
import { zoneForecast } from "./crowd-forecast.ts";
import { Site } from "../engine/site.ts";
import { catalogData } from "../data/catalog.ts";

// Bearings: x east, y south → north is 0°, east 90°
assert.equal(bearingDegrees({ x: 0, y: 0 }, { x: 0, y: -10 }), 0);
assert.equal(bearingDegrees({ x: 0, y: 0 }, { x: 10, y: 0 }), 90);
assert.equal(turnDelta(0, 90), 90, "north then east is a right turn");
assert.equal(turnDelta(0, 270), -90, "north then west is a left turn");
assert.equal(classifyTurn(10), "straight");
assert.equal(classifyTurn(45), "slight_right");
assert.equal(classifyTurn(-90), "left");
assert.equal(classifyTurn(135), "sharp_right");
assert.equal(classifyTurn(170), "uturn");

// Walk north, turn right (east), straight on, then left (north) and arrive
const path = [{ x: 0, y: 0 }, { x: 0, y: -100 }, { x: 100, y: -100 }, { x: 200, y: -102 }, { x: 200, y: -200 }];
const labels = ["البداية", "الصين", "الشام", "المغرب", "مصر"];
const UNIT = 0.62; // metres per plan unit (the venue calibration)
const maneuvers = buildManeuvers(path, labels, UNIT);
assert.deepEqual(maneuvers.map((m) => [m.nodeIndex, m.kind, m.label]), [[1, "right", "الصين"], [3, "left", "المغرب"], [4, "arrive", "مصر"]]);

// Distance along the path to the next turn from a point halfway up the first leg (units × 0.62 m)
const me = { x: 0, y: -50 };
assert.equal(Math.round(distanceAlongPath(path, me, 1, 1, UNIT)), 31);
assert.equal(nextManeuver(maneuvers, 2)?.label, "المغرب");
assert.equal(describeManeuver(maneuvers[0], 31), "بعد 30 م لف يمين عند الصين");
assert.equal(describeManeuver(maneuvers[0], 9), "لف يمين عند الصين الحين");
assert.equal(describeManeuver(maneuvers[2], 8, "منطقة مصر"), "وصلت إلى منطقة مصر");
assert.equal(roundMeters(3), 5);
assert.equal(roundMeters(137), 140);

// Off-route distance: on the path → 0, 50 units to the side → 31 m
assert.equal(distanceFromPath(path, { x: 0, y: -40 }, UNIT), 0);
assert.equal(Math.round(distanceFromPath(path, { x: -50, y: -40 }, UNIT)), 31);

// Popular times: one bar per opening hour, live level replaces the current hour, quietest upcoming hour
const site = new Site(catalogData);
const forecast = zoneForecast(site, "africa", { openingFrom: 1020, openingTo: 1440, nowMinute: 20 * 60 + 15, liveLevel: 0.97 });
assert.deepEqual(forecast.hours.map((h) => h.hour), [17, 18, 19, 20, 21, 22, 23]);
assert.equal(forecast.hours.find((h) => h.hour === 20)?.level, 0.97);
assert.equal(forecast.hours.find((h) => h.hour === 20)?.live, true);
assert.ok(forecast.quietestUpcomingHour >= 20, "quietest hour is never in the past");
assert.equal(forecast.quietestUpcomingHour, 23, "the curve is lowest at 23:00");
// Catalogs that store opening hours as hours give the same bars
assert.deepEqual(zoneForecast(site, "africa", { openingFrom: 17, openingTo: 24, nowMinute: 1020 }).hours.map((h) => h.hour), [17, 18, 19, 20, 21, 22, 23]);

console.log("maneuvers + popular times: all assertions passed");
