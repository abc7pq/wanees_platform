ALTER TABLE "RouteNode"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'open';

ALTER TABLE "VisitorSession"
  ADD COLUMN "assistantContext" JSONB,
  ADD COLUMN "assistantContextExpiresAt" TIMESTAMP(3);

ALTER TABLE "VisitorPreference"
  ADD COLUMN "startMinute" INTEGER;
