import assert from "node:assert/strict";
import { analyticsEventSchema, assistantRequestSchema, createVisitorSessionSchema, itineraryRequestSchema, liveUpdateRequestSchema, replanRequestSchema } from "./api-contracts.ts";

const valid = createVisitorSessionSchema.parse({
  preferences: { mood: "هادئ", interests: ["ثقافة"], availableMinutes: 120 },
});
assert.equal(valid.locale, "ar-SA");
assert.equal(valid.clientType, "web");
assert.equal(valid.preferences.availableMinutes, 120);

assert.equal(
  createVisitorSessionSchema.safeParse({ preferences: { budgetMaxCents: -1 } }).success,
  false,
);
assert.equal(
  createVisitorSessionSchema.safeParse({ unexpected: "field" }).success,
  false,
);
assert.equal(
  itineraryRequestSchema.safeParse({ preferences: { availableMinutes: 90 } }).success,
  true,
);
assert.equal(assistantRequestSchema.safeParse({ message: "وش محطتي التالية؟" }).success, true);
assert.equal(assistantRequestSchema.safeParse({ message: "" }).success, false);
assert.equal(assistantRequestSchema.safeParse({ message: "ok", extra: true }).success, false);
assert.equal(liveUpdateRequestSchema.safeParse({ updateType: "CROWD_OVERRIDE", targetType: "zone", targetId: "lagoon", payload: { level: 0.9 } }).success, true);
assert.equal(liveUpdateRequestSchema.safeParse({ updateType: "CROWD_OVERRIDE", targetType: "activity", payload: { level: 0.9 } }).success, false);
assert.equal(replanRequestSchema.safeParse({ nowMinute: 1180, reason: "crowd" }).success, true);
assert.equal(replanRequestSchema.safeParse({ nowMinute: 2000 }).success, false);
assert.equal(replanRequestSchema.safeParse({ decision: "accept", proposalId: "p", baseItineraryId: "i", baseLiveRevision: "r" }).success, true);

// Visit ratings are whole stars 1–5; other metrics keep their defaults.
assert.equal(analyticsEventSchema.safeParse({ metricName: "visit_rating", metricValue: 5 }).success, true);
assert.equal(analyticsEventSchema.safeParse({ metricName: "visit_rating", metricValue: 1 }).success, true);
assert.equal(analyticsEventSchema.safeParse({ metricName: "visit_rating", metricValue: 0 }).success, false, "a rating below 1 is rejected");
assert.equal(analyticsEventSchema.safeParse({ metricName: "visit_rating", metricValue: 6 }).success, false, "a rating above 5 is rejected");
assert.equal(analyticsEventSchema.safeParse({ metricName: "visit_rating", metricValue: 2.5 }).success, false, "half stars are rejected");
assert.equal(analyticsEventSchema.safeParse({ metricName: "visit_rating" }).success, true, "the default value 1 is a valid rating");
assert.equal(analyticsEventSchema.safeParse({ metricName: "time_to_plan_seconds", metricValue: 36 }).success, true);

console.log("visitor API contract validation passed");
