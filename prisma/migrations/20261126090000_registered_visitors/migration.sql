-- Registered visitors: name + verified phone, scoped to one organization.
-- Additive only. Recovery: drop the four new tables and the two VisitorSession columns;
-- anonymous sessions keep working because visitorId/visitorVisitId are nullable.
-- AlterTable
ALTER TABLE "VisitorSession" ADD COLUMN     "visitorId" TEXT,
ADD COLUMN     "visitorVisitId" TEXT;

-- CreateTable
CREATE TABLE "Visitor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "consentedAt" TIMESTAMP(3) NOT NULL,
    "phoneVerifiedAt" TIMESTAMP(3) NOT NULL,
    "preferences" JSONB,
    "visitedKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Visitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitorDevice" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitorDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitorVisit" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "itineraryActivityKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rating" INTEGER,
    "companions" TEXT,
    "partySize" INTEGER,

    CONSTRAINT "VisitorVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitorOtpChallenge" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "pendingName" TEXT NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitorOtpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Visitor_organizationId_lastSeenAt_idx" ON "Visitor"("organizationId", "lastSeenAt");

-- CreateIndex
CREATE INDEX "Visitor_lastSeenAt_idx" ON "Visitor"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "Visitor_organizationId_phoneE164_key" ON "Visitor"("organizationId", "phoneE164");

-- CreateIndex
CREATE UNIQUE INDEX "VisitorDevice_tokenHash_key" ON "VisitorDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "VisitorDevice_visitorId_idx" ON "VisitorDevice"("visitorId");

-- CreateIndex
CREATE INDEX "VisitorDevice_expiresAt_idx" ON "VisitorDevice"("expiresAt");

-- CreateIndex
CREATE INDEX "VisitorVisit_visitorId_startedAt_idx" ON "VisitorVisit"("visitorId", "startedAt");

-- CreateIndex
CREATE INDEX "VisitorVisit_eventId_startedAt_idx" ON "VisitorVisit"("eventId", "startedAt");

-- CreateIndex
CREATE INDEX "VisitorOtpChallenge_organizationId_phoneE164_createdAt_idx" ON "VisitorOtpChallenge"("organizationId", "phoneE164", "createdAt");

-- CreateIndex
CREATE INDEX "VisitorOtpChallenge_expiresAt_idx" ON "VisitorOtpChallenge"("expiresAt");

-- CreateIndex
CREATE INDEX "VisitorSession_visitorId_idx" ON "VisitorSession"("visitorId");

-- CreateIndex
CREATE INDEX "VisitorSession_visitorVisitId_idx" ON "VisitorSession"("visitorVisitId");

-- AddForeignKey
ALTER TABLE "VisitorSession" ADD CONSTRAINT "VisitorSession_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "Visitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitorSession" ADD CONSTRAINT "VisitorSession_visitorVisitId_fkey" FOREIGN KEY ("visitorVisitId") REFERENCES "VisitorVisit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visitor" ADD CONSTRAINT "Visitor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitorDevice" ADD CONSTRAINT "VisitorDevice_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "Visitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitorVisit" ADD CONSTRAINT "VisitorVisit_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "Visitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitorVisit" ADD CONSTRAINT "VisitorVisit_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitorOtpChallenge" ADD CONSTRAINT "VisitorOtpChallenge_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

