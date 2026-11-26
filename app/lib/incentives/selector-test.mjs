import assert from "node:assert/strict";
import { selectIncentive, toIncentiveDisplay, isEligible } from "./selector.ts";

function inc(overrides = {}) {
  return {
    id: "id",
    kind: "FREE_ITEM",
    titleAr: "قهوتك علينا",
    valueLabelAr: "قهوة مجانية",
    reasonAr: "الازدحام في هذه المنطقة",
    valueCents: 1500,
    priority: 0,
    trigger: null,
    scopeTarget: null,
    scopeKey: null,
    minCrowdLevel: null,
    redirectZoneKey: null,
    endsAt: null,
    locationLabelAr: null,
    perVisitorCap: 1,
    claimsCount: 0,
    ...overrides,
  };
}

function ctx(overrides = {}) {
  return {
    triggers: new Set(["CROWD_OVERRIDE"]),
    zoneStableKey: null,
    crowdLevel: 0,
    waitMinutes: 0,
    alreadyClaimedIds: new Set(),
    ...overrides,
  };
}

let failures = 0;
function check(name, actual, expected) {
  try {
    assert.deepEqual(actual, expected);
    console.log(`  ✅ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  ❌ ${name}: ${error.message}`);
  }
}

const zoneCtx = ctx({ zoneStableKey: "z1", crowdLevel: 0.8 });

// Empty pool → null.
check("empty pool returns null", selectIncentive([], zoneCtx), null);

// Determinism: 100 runs of identical input yield the identical id.
const pool = [
  inc({ id: "a", scopeTarget: "ZONE", scopeKey: "z1" }),
  inc({ id: "b", scopeTarget: "EVENT" }),
];
const chosen = selectIncentive(pool, zoneCtx);
let stable = true;
for (let i = 0; i < 100; i += 1) {
  if (selectIncentive(pool, zoneCtx).id !== chosen.id) stable = false;
}
check("deterministic across 100 runs", stable, true);

// A zone-scoped incentive wins over an event-scoped one when that zone is crowded.
check("zone match preferred", selectIncentive(pool, zoneCtx).id, "a");

// Already-claimed incentives are never re-offered.
check(
  "already claimed excluded",
  selectIncentive(pool, ctx({ zoneStableKey: "z1", crowdLevel: 0.8, alreadyClaimedIds: new Set(["a"]) })).id,
  "b",
);

// perVisitorCap is respected.
check(
  "perVisitorCap exhausted excluded",
  selectIncentive(
    [inc({ id: "c", scopeTarget: "ZONE", scopeKey: "z1", perVisitorCap: 1, claimsCount: 1 }), inc({ id: "d", scopeTarget: "EVENT" })],
    zoneCtx,
  ).id,
  "d",
);

// minCrowdLevel gate.
const gated = inc({ id: "g", scopeTarget: "ZONE", scopeKey: "z1", minCrowdLevel: 0.8 });
check("below minCrowdLevel excluded", selectIncentive([gated], ctx({ zoneStableKey: "z1", crowdLevel: 0.5 })), null);
check("above minCrowdLevel included", selectIncentive([gated], zoneCtx).id, "g");

// Trigger match: a CLOSURE incentive is not offered for a crowd override.
const closure = inc({ id: "cl", trigger: "CLOSURE", scopeTarget: "ZONE", scopeKey: "z1" });
check("trigger mismatch excluded", selectIncentive([closure], zoneCtx), null);
check("trigger match included", selectIncentive([closure], ctx({ ...zoneCtx, triggers: new Set(["CLOSURE"]) })).id, "cl");

// A null-trigger incentive is always eligible regardless of the active trigger.
check("null trigger always eligible", selectIncentive([inc({ id: "any" })], ctx({ triggers: new Set(["DELAY"]) })).id, "any");

// priority breaks a tie on equal score.
check(
  "equal score breaks by priority desc",
  selectIncentive(
    [inc({ id: "p1", priority: 2, scopeTarget: "EVENT" }), inc({ id: "p2", priority: 5, scopeTarget: "EVENT" })],
    zoneCtx,
  ).id,
  "p2",
);

// PRIORITY_ENTRY is gated by wait: no queue → a free item wins; a queue → priority entry wins.
const zoneMatch = { scopeTarget: "ZONE", scopeKey: "z1" };
const freeItem = inc({ id: "fi", kind: "FREE_ITEM", ...zoneMatch });
const priorityEntry = inc({ id: "pe", kind: "PRIORITY_ENTRY", ...zoneMatch });
check("no queue → free item wins", selectIncentive([freeItem, priorityEntry], ctx({ zoneStableKey: "z1", crowdLevel: 0.8, waitMinutes: 0 })).id, "fi");
check("queue → priority entry wins", selectIncentive([freeItem, priorityEntry], ctx({ zoneStableKey: "z1", crowdLevel: 0.8, waitMinutes: 30 })).id, "pe");

// Display rendering — final team contract (incentiveId/valueCents/expiresAt, no legacy fields).
const display = toIncentiveDisplay(inc({ id: "d1", redirectZoneKey: "rz", endsAt: new Date("2026-11-22T00:00:00.000Z") }));
check("display carries incentiveId", display.incentiveId, "d1");
check("display carries kind", display.kind, "FREE_ITEM");
check("display carries valueCents", display.valueCents, 1500);
check("display carries expiresAt", display.expiresAt, "2026-11-22T00:00:00.000Z");
check("display drops redirectZoneKey", "redirectZoneKey" in display, false);
check("display has no legacy id", "id" in display, false);

if (failures > 0) {
  console.error(`incentive selector: ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("incentive selector: all assertions passed");
