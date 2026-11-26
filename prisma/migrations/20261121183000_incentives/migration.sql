-- Incentive/offer support for the replan alert ("قهوتك علينا" and similar).
-- Additive only: three enums, two new tables and their foreign keys. No data change.
-- Alignment: IncentiveTrigger is a subset of EventUpdateType (crowd_spike maps to CROWD_OVERRIDE
-- at the engine boundary); scope is flattened to scopeTarget/scopeKey where scopeKey is a stableKey
-- (no FK, resolved against the event's published catalog at render time).
CREATE TYPE "IncentiveKind" AS ENUM ('FREE_ITEM', 'DISCOUNT', 'PRIORITY_ENTRY', 'FREE_ACTIVITY', 'CREDIT');
CREATE TYPE "IncentiveTrigger" AS ENUM ('CLOSURE', 'DELAY', 'SCHEDULE_CHANGE', 'CROWD_OVERRIDE');
CREATE TYPE "IncentiveScopeTarget" AS ENUM ('EVENT', 'ZONE', 'ACTIVITY');

CREATE TABLE "Incentive" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "kind" "IncentiveKind" NOT NULL,
    "titleAr" TEXT NOT NULL,
    "valueLabelAr" TEXT NOT NULL,
    "reasonAr" TEXT NOT NULL,
    "valueCents" INTEGER NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "trigger" "IncentiveTrigger",
    "scopeTarget" "IncentiveScopeTarget",
    "scopeKey" TEXT,
    "minCrowdLevel" DOUBLE PRECISION,
    "redirectZoneKey" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "perVisitorCap" INTEGER NOT NULL DEFAULT 1,
    "locationLabelAr" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Incentive_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Incentive_eventId_trigger_idx" ON "Incentive"("eventId", "trigger");
CREATE INDEX "Incentive_eventId_scopeTarget_scopeKey_idx" ON "Incentive"("eventId", "scopeTarget", "scopeKey");
CREATE INDEX "Incentive_eventId_startsAt_endsAt_idx" ON "Incentive"("eventId", "startsAt", "endsAt");

CREATE TABLE "VisitorIncentiveClaim" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "incentiveId" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VisitorIncentiveClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisitorIncentiveClaim_sessionId_incentiveId_key" ON "VisitorIncentiveClaim"("sessionId", "incentiveId");
CREATE INDEX "VisitorIncentiveClaim_incentiveId_idx" ON "VisitorIncentiveClaim"("incentiveId");

ALTER TABLE "Incentive"
    ADD CONSTRAINT "Incentive_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VisitorIncentiveClaim"
    ADD CONSTRAINT "VisitorIncentiveClaim_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "VisitorSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VisitorIncentiveClaim"
    ADD CONSTRAINT "VisitorIncentiveClaim_incentiveId_fkey"
    FOREIGN KEY ("incentiveId") REFERENCES "Incentive"("id") ON DELETE CASCADE ON UPDATE CASCADE;
