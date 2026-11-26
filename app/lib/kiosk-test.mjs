// Kiosk screens (audit 5.2) and the agent contract's facts (audit 5.1/5.3).
import assert from "node:assert/strict";
const kiosk = await import("./kiosk.ts");
const contracts = await import("../../packages/contracts/src/index.ts");

const token = kiosk.createKioskToken();
assert.match(token, /^wk_[A-Za-z0-9_-]{43}$/);
assert.notEqual(token, kiosk.createKioskToken());
assert.match(kiosk.hashKioskToken(token), /^[0-9a-f]{64}$/);
const withHeader = (value) => new Request("http://x.test/", { headers: value == null ? {} : { [kiosk.KIOSK_TOKEN_HEADER]: value } });
assert.equal(kiosk.readKioskToken(withHeader(token)), token);
assert.equal(kiosk.readKioskToken(withHeader("wk_short")), null);
assert.equal(kiosk.readKioskToken(withHeader("not-a-kiosk-token-at-all-but-long-enough-to-pass-length")), null);
assert.equal(kiosk.readKioskToken(withHeader(null)), null);

// Idle: a kiosk visit lasts while someone keeps using it, and ends a minute after the last request.
const t0 = new Date("2026-11-28T18:00:00Z");
assert.equal(contracts.KIOSK_IDLE_SECONDS, 60);
assert.equal(kiosk.kioskSessionIdle(t0, new Date(t0.getTime() + 59_000)), false);
assert.equal(kiosk.kioskSessionIdle(t0, new Date(t0.getTime() + 61_000)), true);

// The kiosk's node is the origin; a phone visit has none from here.
assert.deepEqual(kiosk.kioskPosition({ channel: "kiosk", kioskDevice: { nodeKey: "gate-1" } }, t0), { nodeId: "gate-1", source: "kiosk", capturedAt: t0.toISOString() });
assert.equal(kiosk.kioskPosition({ channel: "web", kioskDevice: null }, t0), null);
assert.equal(kiosk.kioskPosition({ channel: "kiosk", kioskDevice: null }, t0), null);

// Facts ignore wording and order; they keep what the visitor must be able to trust.
const a = contracts.agentFacts({ intent: "location", sources: [{ type: "location", id: "wc-2", zone: "asia" }, { type: "location", id: "wc-1", zone: "africa" }], directions: { targetId: "wc-1", totalWalkMin: 3, avoided: [] }, position: { zone: "africa", source: "kiosk" } });
const b = contracts.agentFacts({ intent: "location", sources: [{ type: "location", id: "wc-1", zone: "africa" }, { type: "location", id: "wc-2", zone: "asia" }], directions: { targetId: "wc-1", totalWalkMin: 3, avoided: ["x"] }, position: { zone: "africa", source: "gps" } });
assert.deepEqual(a, b);
assert.notDeepEqual(a, contracts.agentFacts({ ...b, directions: { targetId: "wc-1", totalWalkMin: 4, avoided: [] }, intent: "location", sources: [], position: null }));
assert.deepEqual([...contracts.AGENT_CHANNELS], ["web", "call", "kiosk"]);

console.log("kiosk: all assertions passed");
