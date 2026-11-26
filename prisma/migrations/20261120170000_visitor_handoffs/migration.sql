CREATE TABLE "VisitorHandoff" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "redactedMessage" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "VisitorHandoff_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VisitorHandoff_eventId_status_createdAt_idx" ON "VisitorHandoff"("eventId", "status", "createdAt");
CREATE INDEX "VisitorHandoff_sessionId_createdAt_idx" ON "VisitorHandoff"("sessionId", "createdAt");

ALTER TABLE "VisitorHandoff" ADD CONSTRAINT "VisitorHandoff_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "VisitorSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisitorHandoff" ADD CONSTRAINT "VisitorHandoff_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
