-- Audit item 1.1: the visitor talks and Wanees understands. What it understood is stored on the
-- session's preferences (event-scoped, deleted with the session); never a name, phone or identity.
-- Rollback: drop the six columns; no other table refers to them.
ALTER TABLE "VisitorPreference" ADD COLUMN "childAges" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "likes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "unmatchedInterests" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "avoidTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "mobility" TEXT,
  ADD COLUMN "replyLanguage" TEXT;

ALTER TABLE "VisitorPreference" ADD CONSTRAINT "VisitorPreference_understanding_check" CHECK (
  cardinality("childAges") <= 10 AND cardinality("likes") <= 20 AND cardinality("unmatchedInterests") <= 5
  AND ("mobility" IS NULL OR "mobility" IN ('wheelchair', 'stroller'))
  AND ("replyLanguage" IS NULL OR "replyLanguage" IN ('ar', 'en', 'fr', 'ur'))
);
