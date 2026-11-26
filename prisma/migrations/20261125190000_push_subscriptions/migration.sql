-- Lock-screen nudges: one Web Push subscription per visitor device, scoped to the visit and event.
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "endpointHash" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "openPath" TEXT NOT NULL,
    "sentNudgeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastCheckedAt" TIMESTAMP(3),
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushSubscription_endpointHash_key" ON "PushSubscription"("endpointHash");
CREATE INDEX "PushSubscription_eventId_expiresAt_idx" ON "PushSubscription"("eventId", "expiresAt");
CREATE INDEX "PushSubscription_expiresAt_idx" ON "PushSubscription"("expiresAt");
CREATE INDEX "PushSubscription_sessionId_idx" ON "PushSubscription"("sessionId");

ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "VisitorSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Rollback: DROP TABLE "PushSubscription"; (visitors simply stop getting lock-screen nudges;
-- the in-app nudges keep working, and each device re-subscribes on its next opt-in)
