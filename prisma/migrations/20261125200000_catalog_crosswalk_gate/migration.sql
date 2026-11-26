-- Catalog crosswalk gate.
-- Invariant: a CatalogVersion can become PUBLISHED, or be pointed at by
-- Event.publishedCatalogVersionId, only when its crosswalk is VERIFIED (with a
-- SHA-256 checksum) or NOT_REQUIRED (catalogs published before this gate).
-- The app checks this in admin/lib/catalog-crosswalk-gate.ts; the constraint
-- and triggers below hold it for scripts and raw SQL too.

CREATE TYPE "CatalogCrosswalkStatus" AS ENUM ('NOT_REQUIRED', 'HOLD', 'VERIFIED');

ALTER TABLE "CatalogVersion"
  ADD COLUMN "crosswalkStatus" "CatalogCrosswalkStatus" NOT NULL DEFAULT 'HOLD',
  ADD COLUMN "crosswalkChecksum" TEXT,
  ADD COLUMN "crosswalkVerifiedAt" TIMESTAMP(3);

-- Live and previously live catalogs keep working unchanged. Every other
-- version (drafts, rejected, validating) stays on the HOLD default.
UPDATE "CatalogVersion" SET "crosswalkStatus" = 'NOT_REQUIRED'
  WHERE "status" IN ('PUBLISHED', 'SUPERSEDED');

ALTER TABLE "CatalogVersion" ADD CONSTRAINT "CatalogVersion_crosswalk_verified_checksum"
  -- IS NOT NULL is needed: NULL ~ pattern is NULL, and a CHECK accepts NULL.
  CHECK ("crosswalkStatus" <> 'VERIFIED'
         OR ("crosswalkChecksum" IS NOT NULL AND "crosswalkChecksum" ~ '^[0-9a-f]{64}$'));

CREATE FUNCTION wanees_catalog_version_crosswalk_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."crosswalkStatus" = 'NOT_REQUIRED' THEN
    IF TG_OP = 'INSERT' AND NEW."status" NOT IN ('PUBLISHED', 'SUPERSEDED') THEN
      RAISE EXCEPTION 'CROSSWALK_NOT_REQUIRED_FORBIDDEN: only an already published catalog may skip the crosswalk review'
        USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD."crosswalkStatus" <> 'NOT_REQUIRED' THEN
      RAISE EXCEPTION 'CROSSWALK_NOT_REQUIRED_FORBIDDEN: a catalog under review cannot be marked as not needing review'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW."status" = 'PUBLISHED' AND NEW."crosswalkStatus" = 'HOLD'
     AND (TG_OP = 'INSERT' OR OLD."status" IS DISTINCT FROM 'PUBLISHED') THEN
    RAISE EXCEPTION 'CROSSWALK_HOLD: catalog version % cannot be published while its crosswalk is on HOLD', NEW."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "CatalogVersion_crosswalk_guard"
  BEFORE INSERT OR UPDATE ON "CatalogVersion"
  FOR EACH ROW EXECUTE FUNCTION wanees_catalog_version_crosswalk_guard();

CREATE FUNCTION wanees_event_published_catalog_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."publishedCatalogVersionId" IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW."publishedCatalogVersionId" IS DISTINCT FROM OLD."publishedCatalogVersionId")
     AND EXISTS (SELECT 1 FROM "CatalogVersion" v
                 WHERE v."id" = NEW."publishedCatalogVersionId" AND v."crosswalkStatus" = 'HOLD') THEN
    RAISE EXCEPTION 'CROSSWALK_HOLD: event % cannot point at a catalog whose crosswalk is on HOLD', NEW."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "Event_published_catalog_crosswalk_guard"
  BEFORE INSERT OR UPDATE OF "publishedCatalogVersionId" ON "Event"
  FOR EACH ROW EXECUTE FUNCTION wanees_event_published_catalog_guard();

-- Any change to a draft's content drops a VERIFIED crosswalk back to HOLD,
-- whether it comes from the admin API or from raw SQL.
CREATE FUNCTION wanees_crosswalk_drop_to_hold(version_id TEXT) RETURNS void LANGUAGE sql AS $$
  UPDATE "CatalogVersion"
     SET "crosswalkStatus" = 'HOLD', "crosswalkChecksum" = NULL, "crosswalkVerifiedAt" = NULL
   WHERE "id" = version_id AND "crosswalkStatus" = 'VERIFIED'
     AND "status" IN ('DRAFT', 'VALIDATING', 'REJECTED');
$$;

CREATE FUNCTION wanees_catalog_content_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  row_new JSONB := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END;
  row_old JSONB := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END;
BEGIN
  IF TG_TABLE_NAME = 'Schedule' THEN
    PERFORM wanees_crosswalk_drop_to_hold(a."catalogVersionId") FROM "Activity" a
      WHERE a."id" IN (row_new->>'activityId', row_old->>'activityId');
  ELSE
    IF row_new IS NOT NULL THEN
      PERFORM wanees_crosswalk_drop_to_hold(row_new->>'catalogVersionId');
    END IF;
    IF row_old IS NOT NULL AND row_old->>'catalogVersionId' IS DISTINCT FROM row_new->>'catalogVersionId' THEN
      PERFORM wanees_crosswalk_drop_to_hold(row_old->>'catalogVersionId');
    END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER "Zone_crosswalk_content_changed" AFTER INSERT OR UPDATE OR DELETE ON "Zone"
  FOR EACH ROW EXECUTE FUNCTION wanees_catalog_content_changed();
CREATE TRIGGER "Activity_crosswalk_content_changed" AFTER INSERT OR UPDATE OR DELETE ON "Activity"
  FOR EACH ROW EXECUTE FUNCTION wanees_catalog_content_changed();
CREATE TRIGGER "Schedule_crosswalk_content_changed" AFTER INSERT OR UPDATE OR DELETE ON "Schedule"
  FOR EACH ROW EXECUTE FUNCTION wanees_catalog_content_changed();
CREATE TRIGGER "RouteNode_crosswalk_content_changed" AFTER INSERT OR UPDATE OR DELETE ON "RouteNode"
  FOR EACH ROW EXECUTE FUNCTION wanees_catalog_content_changed();
CREATE TRIGGER "RouteEdge_crosswalk_content_changed" AFTER INSERT OR UPDATE OR DELETE ON "RouteEdge"
  FOR EACH ROW EXECUTE FUNCTION wanees_catalog_content_changed();
CREATE TRIGGER "ContentSource_crosswalk_content_changed" AFTER INSERT OR UPDATE OR DELETE ON "ContentSource"
  FOR EACH ROW EXECUTE FUNCTION wanees_catalog_content_changed();
