-- 1. Public event slugs are unique across every organization.
--    Visitor URLs carry only the slug; the admin create route already checks this in code,
--    but two concurrent creates could still collide. The index closes that race.
--    Recovery: if this migration stops on duplicates, rename one of each pair
--    (UPDATE "Event" SET slug = '<new>' WHERE id = '<id>') and re-run `npm run db:deploy`.
--    Rollback: DROP INDEX "Event_slug_key"; the per-organization index stays in place.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Event" GROUP BY "slug" HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate public event slugs exist across organizations. Rename them before applying this migration (see docs/DATABASE_SCHEMA.md).';
  END IF;
END $$;

CREATE UNIQUE INDEX "Event_slug_key" ON "Event"("slug");

-- 2. Guest profiles carry an organization scope, like registered visitors.
--    Existing profiles take the organization of their most recent session. Sessions of the same
--    profile at another organization are detached (the session itself keeps working).
--    Profiles with no session cannot be scoped and are removed; they only held a preference
--    snapshot and the visitor is asked again on the next visit.
--    Rollback: drop the organizationId column, its foreign key and the two new indexes, and
--    restore the unique index on "publicTokenHash" (only safe while no token has two profiles).
ALTER TABLE "GuestProfile" ADD COLUMN "organizationId" TEXT;

UPDATE "GuestProfile" AS profile
SET "organizationId" = latest."organizationId"
FROM (
  SELECT DISTINCT ON (session."guestProfileId") session."guestProfileId" AS "profileId", event."organizationId"
  FROM "VisitorSession" AS session
  INNER JOIN "Event" AS event ON event.id = session."eventId"
  WHERE session."guestProfileId" IS NOT NULL
  ORDER BY session."guestProfileId", session."startedAt" DESC
) AS latest
WHERE profile.id = latest."profileId";

UPDATE "VisitorSession" AS session
SET "guestProfileId" = NULL
FROM "Event" AS event, "GuestProfile" AS profile
WHERE session."eventId" = event.id
  AND session."guestProfileId" = profile.id
  AND profile."organizationId" IS DISTINCT FROM event."organizationId";

DELETE FROM "GuestProfile" WHERE "organizationId" IS NULL;

ALTER TABLE "GuestProfile" ALTER COLUMN "organizationId" SET NOT NULL;

DROP INDEX "GuestProfile_publicTokenHash_key";

CREATE UNIQUE INDEX "GuestProfile_organizationId_publicTokenHash_key" ON "GuestProfile"("organizationId", "publicTokenHash");

CREATE INDEX "GuestProfile_publicTokenHash_idx" ON "GuestProfile"("publicTokenHash");

ALTER TABLE "GuestProfile" ADD CONSTRAINT "GuestProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
