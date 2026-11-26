-- Anonymous, expiring device presence for crowd sensing (zone only, no session link).
CREATE TABLE "PresencePing" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "deviceKey" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PresencePing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PresencePing_eventId_deviceKey_key" ON "PresencePing"("eventId", "deviceKey");
CREATE INDEX "PresencePing_eventId_expiresAt_idx" ON "PresencePing"("eventId", "expiresAt");
CREATE INDEX "PresencePing_expiresAt_idx" ON "PresencePing"("expiresAt");

ALTER TABLE "PresencePing" ADD CONSTRAINT "PresencePing_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PresencePing" ADD CONSTRAINT "PresencePing_zoneId_fkey"
  FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Rollback: DROP TABLE "PresencePing"; (data is ephemeral, nothing to recover)
