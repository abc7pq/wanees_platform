import assert from "node:assert/strict";
import { crowdFromPresence, presenceConfig, presenceDeviceKey, resolvePresenceZone } from "./presence.ts";
import { fromLatLng, toLatLng } from "./venue-gps.ts";

// GPS ↔ venue plan round trip
const [lat, lng] = toLatLng(219, -312);
const back = fromLatLng(lat, lng);
assert.ok(Math.abs(back.x - 219) < 0.01 && Math.abs(back.y + 312) < 0.01, "fromLatLng inverts toLatLng");

// Zone resolution: nearest open node with a zone, within 120 m, accuracy ≤ 75 m
const nodes = [
  { id: "zone-africa", label: "أفريقيا", x: 219, y: -312, status: "open", zone: "africa" },
  { id: "zone-egypt", label: "مصر", x: 448, y: -250, status: "open", zone: "egypt" },
  { id: "zone-closed", label: "مغلق", x: 230, y: -310, status: "closed", zone: "closed" },
  { id: "gate", label: "بوابة", x: 225, y: -312, status: "open", zone: null },
];
const [nearAfricaLat, nearAfricaLng] = toLatLng(240, -300);
const fix = resolvePresenceZone({ latitude: nearAfricaLat, longitude: nearAfricaLng, accuracy: 10 }, nodes);
assert.equal(fix.status, "ready");
assert.equal(fix.zone, "africa", "skips closed and zoneless nodes");
assert.equal(resolvePresenceZone({ latitude: nearAfricaLat, longitude: nearAfricaLng, accuracy: 200 }, nodes).status, "inaccurate");
const [farLat, farLng] = toLatLng(2000, 2000);
assert.equal(resolvePresenceZone({ latitude: farLat, longitude: farLng, accuracy: 5 }, nodes).status, "outside");
assert.equal(resolvePresenceZone({ latitude: Number.NaN, longitude: 1, accuracy: 5 }, nodes).status, "inaccurate");

// Device key: stable within the hour, rotates across hours, never contains the session id
const t0 = new Date("2026-11-25T18:10:00Z");
const keyA = presenceDeviceKey("salt", "event", "session-123", t0);
assert.equal(keyA, presenceDeviceKey("salt", "event", "session-123", new Date("2026-11-25T18:55:00Z")));
assert.notEqual(keyA, presenceDeviceKey("salt", "event", "session-123", new Date("2026-11-25T19:01:00Z")));
assert.notEqual(keyA, presenceDeviceKey("other-salt", "event", "session-123", t0));
assert.ok(!keyA.includes("session"));

// Crowd from device counts: k-anonymity floor, sample scaling, capacity, clamping, deterministic order
const config = { sampleRate: 0.1, minDevices: 3, defaultCapacity: 300 };
const readings = crowdFromPresence(
  new Map([["z-b", 24], ["z-a", 12], ["z-lonely", 2], ["z-full", 100]]),
  new Map([["z-a", 200], ["z-b", null], ["z-full", 50]]),
  config,
);
assert.deepEqual(readings.map((row) => row.zoneId), ["z-a", "z-b", "z-full"], "zones under the device floor are not published");
const a = readings.find((row) => row.zoneId === "z-a");
assert.equal(a.estimatedPeople, 120);
assert.equal(a.level, 0.6);
const b = readings.find((row) => row.zoneId === "z-b");
assert.equal(b.level, 0.8, "default capacity applies when the organizer left it empty");
assert.equal(readings.find((row) => row.zoneId === "z-full").level, 1, "level is clamped to 1");
assert.ok(b.confidence > a.confidence, "more devices → more confidence");
assert.deepEqual(crowdFromPresence(new Map([["z", 2]]), new Map(), config), []);

// Config parsing falls back on invalid values
assert.deepEqual(presenceConfig({}), { sampleRate: 0.08, minDevices: 3, defaultCapacity: 300 });
assert.deepEqual(presenceConfig({ WANEES_PRESENCE_SAMPLE_RATE: "5", WANEES_PRESENCE_MIN_DEVICES: "x" }), { sampleRate: 0.08, minDevices: 3, defaultCapacity: 300 });
assert.equal(presenceConfig({ WANEES_PRESENCE_SAMPLE_RATE: "0.2" }).sampleRate, 0.2);

console.log("presence crowd sensing: all assertions passed");
