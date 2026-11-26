-- Session deletion cascades to AssistantEvent. Without this index the
-- referential-integrity check for the cascade does a sequential scan of the
-- growing assistant telemetry table.
CREATE INDEX "AssistantEvent_sessionId_idx" ON "AssistantEvent"("sessionId");

-- Rollback:
-- DROP INDEX "AssistantEvent_sessionId_idx";
