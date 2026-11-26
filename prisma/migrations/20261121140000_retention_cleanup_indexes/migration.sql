-- Indexes for the global filters used by `npm run db:cleanup`.
-- ConversationTurn and VisitorSession are otherwise only indexed by session/event,
-- so the retention deletes could not use an index and scanned the full table.
CREATE INDEX "ConversationTurn_retentionExpiresAt_idx" ON "ConversationTurn"("retentionExpiresAt");
CREATE INDEX "VisitorSession_expiresAt_idx" ON "VisitorSession"("expiresAt");
