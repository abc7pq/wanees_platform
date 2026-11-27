-- Audit 5.2: kiosk screens at the venue.
-- KioskDevice: one screen at one walkway node, signing in with a token stored only as a SHA-256 hash.
-- VisitorSession.kioskDeviceId: set only for a kiosk session (channel = 'kiosk').
-- Rollback (nothing else refers to these):
--   ALTER TABLE "VisitorSession" DROP CONSTRAINT "VisitorSession_kiosk_channel_check";
--   ALTER TABLE "VisitorSession" DROP COLUMN "kioskDeviceId";
--   DROP TABLE "KioskDevice";
-- AlterTable
ALTER TABLE "VisitorSession" ADD COLUMN     "kioskDeviceId" TEXT;

-- CreateTable
CREATE TABLE "KioskDevice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nodeKey" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KioskDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KioskDevice_tokenHash_key" ON "KioskDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "KioskDevice_eventId_idx" ON "KioskDevice"("eventId");

-- CreateIndex
CREATE INDEX "KioskDevice_organizationId_idx" ON "KioskDevice"("organizationId");

-- CreateIndex
CREATE INDEX "VisitorSession_kioskDeviceId_idx" ON "VisitorSession"("kioskDeviceId");

-- AddForeignKey
ALTER TABLE "VisitorSession" ADD CONSTRAINT "VisitorSession_kioskDeviceId_fkey" FOREIGN KEY ("kioskDeviceId") REFERENCES "KioskDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskDevice" ADD CONSTRAINT "KioskDevice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskDevice" ADD CONSTRAINT "KioskDevice_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A session with a kiosk is a kiosk session; a kiosk session whose device was deleted keeps channel 'kiosk'.
ALTER TABLE "VisitorSession" ADD CONSTRAINT "VisitorSession_kiosk_channel_check" CHECK ("kioskDeviceId" IS NULL OR "channel" = 'kiosk');
ALTER TABLE "KioskDevice" ADD CONSTRAINT "KioskDevice_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 80);
