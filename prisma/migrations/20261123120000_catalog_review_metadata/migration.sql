-- Keep imported catalog records traceable to their source and explicitly reviewable.
ALTER TABLE "Zone"
  ADD COLUMN "reviewStatus" "ContentReviewStatus" NOT NULL DEFAULT 'UNREVIEWED',
  ADD COLUMN "sourceRefs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "Activity"
  ADD COLUMN "reviewStatus" "ContentReviewStatus" NOT NULL DEFAULT 'UNREVIEWED',
  ADD COLUMN "sourceRefs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
