-- Admin updates and initial visitor requests reserve keys at event scope.
ALTER TABLE "IdempotencyRecord" ALTER COLUMN "sessionId" DROP NOT NULL;
