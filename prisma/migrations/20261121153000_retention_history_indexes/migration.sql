-- The live-history retention job filters globally on these timestamps, so the
-- composite event_id-leading indexes cannot serve its cutoff scans.
--
-- On a large production table, create these with CREATE INDEX CONCURRENTLY
-- outside a transaction instead of applying this transactional migration.
CREATE INDEX "CrowdSnapshot_observedAt_idx" ON "CrowdSnapshot"("observedAt");
CREATE INDEX "EventUpdate_createdAt_idx" ON "EventUpdate"("createdAt");

-- Rollback:
-- DROP INDEX "CrowdSnapshot_observedAt_idx";
-- DROP INDEX "EventUpdate_createdAt_idx";
