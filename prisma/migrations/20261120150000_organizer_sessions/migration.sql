CREATE TABLE "OrganizerSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "OrganizerSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizerSession_tokenHash_key" ON "OrganizerSession"("tokenHash");
CREATE INDEX "OrganizerSession_userId_expiresAt_idx" ON "OrganizerSession"("userId", "expiresAt");
CREATE INDEX "OrganizerSession_expiresAt_revokedAt_idx" ON "OrganizerSession"("expiresAt", "revokedAt");

ALTER TABLE "OrganizerSession" ADD CONSTRAINT "OrganizerSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
