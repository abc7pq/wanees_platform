-- Audit item 3.4: an activity can name the walkway node at its entrance (a RouteNode stableKey in
-- the same catalog version), so «دلّني» ends at the door instead of the zone centre. Optional: an
-- activity without one keeps routing to its zone. The API checks the node exists, is in the same
-- zone and is open. Rollback: ALTER TABLE "Activity" DROP COLUMN "entranceNodeKey"; (nothing refers to it)
ALTER TABLE "Activity" ADD COLUMN "entranceNodeKey" TEXT;
