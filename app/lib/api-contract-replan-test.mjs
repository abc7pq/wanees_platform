import assert from "node:assert/strict";
import { liveUpdateRequestSchema, replanRequestSchema } from "./api-contracts.ts";

const validUpdate = liveUpdateRequestSchema.safeParse({
  updateType: "CLOSURE",
  targetType: "event",
  startsAt: "2026-11-21T10:00:00+03:00",
  endsAt: "2026-11-21T11:00:00+03:00",
});
assert.equal(validUpdate.success, true);

const reversedUpdate = liveUpdateRequestSchema.safeParse({
  updateType: "CLOSURE",
  targetType: "event",
  startsAt: "2026-11-21T11:00:00+03:00",
  endsAt: "2026-11-21T10:00:00+03:00",
});
assert.equal(reversedUpdate.success, false);

const validAccept = replanRequestSchema.safeParse({
  decision: "accept",
  proposalId: "proposal-1",
  baseItineraryId: "itinerary-1",
  baseLiveRevision: "revision-7",
});
assert.equal(validAccept.success, true);

for (const missing of ["proposalId", "baseItineraryId", "baseLiveRevision"]) {
  const input = {
    decision: "accept",
    proposalId: "proposal-1",
    baseItineraryId: "itinerary-1",
    baseLiveRevision: "revision-7",
  };
  delete input[missing];
  assert.equal(replanRequestSchema.safeParse(input).success, false, missing);
}

assert.equal(replanRequestSchema.safeParse({ decision: "preview" }).success, true);
console.log("replan contract invariants passed");
