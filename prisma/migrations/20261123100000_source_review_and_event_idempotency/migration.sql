-- Preserve source provenance and allow idempotency reservations before a visitor session exists.
CREATE TYPE "ContentReviewStatus" AS ENUM ('UNREVIEWED', 'VERIFIED', 'REJECTED');

ALTER TABLE "ContentSource"
  ADD COLUMN "reviewStatus" "ContentReviewStatus" NOT NULL DEFAULT 'UNREVIEWED';

ALTER TABLE "IdempotencyRecord"
  ADD COLUMN "eventId" TEXT;

UPDATE "IdempotencyRecord" AS record
SET "eventId" = session."eventId"
FROM "VisitorSession" AS session
WHERE record."sessionId" = session."id";

CREATE UNIQUE INDEX "IdempotencyRecord_eventId_key_key"
  ON "IdempotencyRecord"("eventId", "key");

CREATE INDEX "IdempotencyRecord_eventId_idx"
  ON "IdempotencyRecord"("eventId");

ALTER TABLE "IdempotencyRecord"
  ADD CONSTRAINT "IdempotencyRecord_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
