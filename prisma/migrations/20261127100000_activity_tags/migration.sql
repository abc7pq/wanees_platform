-- Audit item 1.3: rich event content. Controlled tags, assistant tag suggestions awaiting an
-- organizer, and highlights. All columns default to empty arrays, so existing rows stay valid.
-- Rollback: ALTER TABLE "Activity" DROP COLUMN "tags", DROP COLUMN "tagSuggestions",
--           DROP COLUMN "highlightsAr", DROP COLUMN "highlightsEn";  (no other table refers to them)
ALTER TABLE "Activity" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "tagSuggestions" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "highlightsAr" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "highlightsEn" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- At most 20 tags and 20 pending suggestions per activity (the API also enforces this).
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_tags_limit_check" CHECK (cardinality("tags") <= 20 AND cardinality("tagSuggestions") <= 20);
