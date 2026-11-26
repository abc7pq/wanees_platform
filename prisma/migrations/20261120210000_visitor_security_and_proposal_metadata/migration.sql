ALTER TABLE "Itinerary"
  ADD COLUMN "baseItineraryId" TEXT,
  ADD COLUMN "baseLiveRevision" TEXT,
  ADD COLUMN "proposalExpiresAt" TIMESTAMP(3),
  ADD COLUMN "decisionAt" TIMESTAMP(3);

CREATE INDEX "Itinerary_sessionId_status_proposalExpiresAt_idx"
  ON "Itinerary"("sessionId", "status", "proposalExpiresAt");

CREATE INDEX "Itinerary_sessionId_baseLiveRevision_idx"
  ON "Itinerary"("sessionId", "baseLiveRevision");

CREATE TABLE "RateLimitBucket" (
  "id" TEXT NOT NULL,
  "bucketKey" TEXT NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RateLimitBucket_bucketKey_key" ON "RateLimitBucket"("bucketKey");
CREATE INDEX "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket"("expiresAt");
