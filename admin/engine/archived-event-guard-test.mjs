// An archived event is read-only: every organizer write under it is refused except restoring it.
import assert from "node:assert/strict";

const { archivedWriteTarget } = await import("../lib/archived-event-guard.ts");

// Writes that must be refused on an archived event
for (const [method, path] of [
  ["POST", "/api/v1/events/boulevard-world/catalog/items"],
  ["PATCH", "/api/v1/events/boulevard-world/catalog/items/sky-loop"],
  ["POST", "/api/v1/events/boulevard-world/catalog/publish"],
  ["POST", "/api/v1/events/boulevard-world/catalog/rollback"],
  ["POST", "/api/v1/events/boulevard-world/updates"],
  ["PATCH", "/api/v1/events/boulevard-world/updates/u1"],
  ["POST", "/api/v1/events/boulevard-world/incentives"],
  ["DELETE", "/api/v1/events/boulevard-world/incentives/i1"],
  ["PATCH", "/api/v1/events/boulevard-world/handoffs"],
]) {
  assert.equal(archivedWriteTarget(method, path), "boulevard-world", `${method} ${path} must be checked`);
}

// Reads, the restore itself, and read-only previews are never blocked
assert.equal(archivedWriteTarget("GET", "/api/v1/events/boulevard-world/catalog"), null);
assert.equal(archivedWriteTarget("head", "/api/v1/events/boulevard-world/analytics"), null);
assert.equal(archivedWriteTarget("PATCH", "/api/v1/events/boulevard-world/status"), null);
assert.equal(archivedWriteTarget("POST", "/api/v1/events/boulevard-world/updates/dry-run"), null);
assert.equal(archivedWriteTarget("POST", "/api/v1/events/boulevard-world/updates/impact"), null);

// Routes outside one event are not event writes
assert.equal(archivedWriteTarget("POST", "/api/v1/events"), null);
assert.equal(archivedWriteTarget("POST", "/api/v1/users"), null);
assert.equal(archivedWriteTarget("POST", "/api/login"), null);

// Encoded slugs are decoded; malformed encoding is ignored rather than thrown
assert.equal(archivedWriteTarget("POST", "/api/v1/events/sample%2Dfestival/updates"), "sample-festival");
assert.equal(archivedWriteTarget("POST", "/api/v1/events/%E0%A4%A/updates"), null);

console.log("archived event guard rules passed");
