-- Venue navigation settings (audit items 0.2, 3.6 and 3.7).
--
-- Live walking guidance and GPS calibration used to be decided in code: a catalog seeded from a
-- fixture was always "demo navigation", and one hard-coded anchor (Boulevard World) converted GPS
-- to venue-plan coordinates for two slugs only. They are now organizer settings on the venue, so
-- any event gets GPS from database values alone and the organizer can switch guidance on or off
-- (audited) without republishing the catalog.
--
-- geoAnchorLat/geoAnchorLng: the GPS position of plan point (0, 0).
-- metersPerUnit: metres per plan unit.
-- rotationDeg: clockwise rotation of the plan's x axis from true east.
-- liveGuidance: the phone may guide the visitor from real GPS (needs a full calibration).
-- navigationAccuracy: SURVEYED (walked and checked on site) or APPROXIMATE (traced from a map);
--   APPROXIMATE guidance tells the visitor to follow the venue signs too.
-- gpsSimulation: staff and demo testing with ?gps=simulate; off unless the organizer enables it.
--
-- Additive only: existing venues keep guidance off and no calibration until the organizer sets it.
-- Rollback: drop the CHECK constraints, the seven columns and the enum.

CREATE TYPE "NavigationAccuracy" AS ENUM ('SURVEYED', 'APPROXIMATE');

ALTER TABLE "Venue"
  ADD COLUMN "geoAnchorLat" DOUBLE PRECISION,
  ADD COLUMN "geoAnchorLng" DOUBLE PRECISION,
  ADD COLUMN "metersPerUnit" DOUBLE PRECISION,
  ADD COLUMN "rotationDeg" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "liveGuidance" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "navigationAccuracy" "NavigationAccuracy" NOT NULL DEFAULT 'APPROXIMATE',
  ADD COLUMN "gpsSimulation" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Venue" ADD CONSTRAINT "Venue_geo_calibration_check" CHECK (
  (
    "geoAnchorLat" IS NULL AND "geoAnchorLng" IS NULL AND "metersPerUnit" IS NULL
  ) OR (
    "geoAnchorLat" BETWEEN -90 AND 90
    AND "geoAnchorLng" BETWEEN -180 AND 180
    AND "metersPerUnit" > 0 AND "metersPerUnit" <= 100
  )
);

ALTER TABLE "Venue" ADD CONSTRAINT "Venue_rotation_check" CHECK ("rotationDeg" >= -180 AND "rotationDeg" <= 180);

-- Live guidance without a calibration would place the visitor on the wrong side of the venue.
ALTER TABLE "Venue" ADD CONSTRAINT "Venue_live_guidance_check" CHECK (NOT "liveGuidance" OR "geoAnchorLat" IS NOT NULL);
