ALTER TABLE "EventUpdate"
  ADD COLUMN "revokedByUserId" TEXT,
  ADD COLUMN "revokedAt" TIMESTAMP(3),
  ADD COLUMN "revocationReason" TEXT;

ALTER TABLE "CrowdSnapshot"
  ADD COLUMN "eventUpdateId" TEXT;

CREATE INDEX "EventUpdate_eventId_revokedAt_createdAt_idx"
  ON "EventUpdate"("eventId", "revokedAt", "createdAt");

CREATE INDEX "CrowdSnapshot_eventUpdateId_idx"
  ON "CrowdSnapshot"("eventUpdateId");

ALTER TABLE "EventUpdate"
  ADD CONSTRAINT "EventUpdate_revokedByUserId_fkey"
  FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CrowdSnapshot"
  ADD CONSTRAINT "CrowdSnapshot_eventUpdateId_fkey"
  FOREIGN KEY ("eventUpdateId") REFERENCES "EventUpdate"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Older operator crowd updates wrote their snapshot in the same transaction.
-- Associate only mutually-nearest one-to-one matches; leave ambiguous history intact.
WITH ranked_matches AS (
  SELECT
    snapshot."id" AS "snapshotId",
    event_update."id" AS "updateId",
    ROW_NUMBER() OVER (
      PARTITION BY snapshot."id"
      ORDER BY ABS(EXTRACT(EPOCH FROM (snapshot."observedAt" - event_update."createdAt"))), event_update."id"
    ) AS "snapshotRank",
    ROW_NUMBER() OVER (
      PARTITION BY event_update."id"
      ORDER BY ABS(EXTRACT(EPOCH FROM (snapshot."observedAt" - event_update."createdAt"))), snapshot."id"
    ) AS "updateRank"
  FROM "CrowdSnapshot" AS snapshot
  JOIN "Zone" AS zone ON zone."id" = snapshot."zoneId"
  JOIN "EventUpdate" AS event_update
    ON event_update."eventId" = snapshot."eventId"
   AND event_update."updateType" = 'CROWD_OVERRIDE'
   AND event_update."targetType" = 'zone'
   AND event_update."targetId" = zone."stableKey"
   AND snapshot."source" = 'OPERATOR'
   AND snapshot."observedAt" >= event_update."createdAt" - INTERVAL '1 second'
   AND snapshot."observedAt" <= event_update."createdAt" + INTERVAL '2 minutes'
  WHERE snapshot."eventUpdateId" IS NULL
)
UPDATE "CrowdSnapshot" AS snapshot
SET "eventUpdateId" = ranked."updateId"
FROM ranked_matches AS ranked
WHERE snapshot."id" = ranked."snapshotId"
  AND ranked."snapshotRank" = 1
  AND ranked."updateRank" = 1;
