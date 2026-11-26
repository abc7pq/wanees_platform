-- Party size and youngest child's age for family planning. Both nullable: existing
-- sessions keep planning per head with age-limited activities excluded for children.
-- Recovery: dropping both columns is safe; no other table references them.
ALTER TABLE "VisitorPreference" ADD COLUMN "partySize" INTEGER;
ALTER TABLE "VisitorPreference" ADD COLUMN "youngestChildAge" INTEGER;
ALTER TABLE "VisitorPreference" ADD CONSTRAINT "VisitorPreference_partySize_check" CHECK ("partySize" IS NULL OR "partySize" BETWEEN 1 AND 20);
ALTER TABLE "VisitorPreference" ADD CONSTRAINT "VisitorPreference_youngestChildAge_check" CHECK ("youngestChildAge" IS NULL OR "youngestChildAge" BETWEEN 0 AND 17);
