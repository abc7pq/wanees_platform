-- Audit items 4.1–4.3: opt-in guest memory, returning visits, and phone ↔ screen link codes.
-- GuestProfile counts the visits an opted-in guest started; VisitorSession records its channel and the
-- activities from earlier visits (so a returning plan does not repeat them); VisitorLinkGrant holds
-- a hashed 6-character code, valid 10 minutes, redeemable once for a read-only kiosk conversation.
-- Rollback: DROP TABLE "VisitorLinkGrant";
--           ALTER TABLE "VisitorSession" DROP COLUMN "channel", DROP COLUMN "previouslyVisited";
--           ALTER TABLE "GuestProfile" DROP COLUMN "visitCount", DROP COLUMN "lastVisitAt";
-- Nothing else refers to these columns; existing rows get safe defaults (web, no prior visits, 0).
-- AlterTable
ALTER TABLE "GuestProfile" ADD COLUMN     "lastVisitAt" TIMESTAMP(3),
ADD COLUMN     "visitCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "VisitorSession" ADD COLUMN     "channel" TEXT NOT NULL DEFAULT 'web',
ADD COLUMN     "previouslyVisited" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "VisitorLinkGrant" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'read',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "redeemedAt" TIMESTAMP(3),
    "redeemedBySessionId" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitorLinkGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VisitorLinkGrant_sessionId_idx" ON "VisitorLinkGrant"("sessionId");

-- CreateIndex
CREATE INDEX "VisitorLinkGrant_redeemedBySessionId_idx" ON "VisitorLinkGrant"("redeemedBySessionId");

-- CreateIndex
CREATE INDEX "VisitorLinkGrant_expiresAt_idx" ON "VisitorLinkGrant"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "VisitorLinkGrant_eventId_codeHash_key" ON "VisitorLinkGrant"("eventId", "codeHash");

-- AddForeignKey
ALTER TABLE "VisitorLinkGrant" ADD CONSTRAINT "VisitorLinkGrant_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitorLinkGrant" ADD CONSTRAINT "VisitorLinkGrant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "VisitorSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitorLinkGrant" ADD CONSTRAINT "VisitorLinkGrant_redeemedBySessionId_fkey" FOREIGN KEY ("redeemedBySessionId") REFERENCES "VisitorSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Only known channels and scopes.
ALTER TABLE "VisitorSession" ADD CONSTRAINT "VisitorSession_channel_check" CHECK ("channel" IN ('web', 'call', 'kiosk'));
ALTER TABLE "VisitorLinkGrant" ADD CONSTRAINT "VisitorLinkGrant_scope_check" CHECK ("scope" IN ('read'));
ALTER TABLE "GuestProfile" ADD CONSTRAINT "GuestProfile_visitCount_check" CHECK ("visitCount" >= 0);
