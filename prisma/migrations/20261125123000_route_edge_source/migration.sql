ALTER TABLE "RouteEdge" ADD COLUMN "sourceId" TEXT;
CREATE INDEX "RouteEdge_sourceId_idx" ON "RouteEdge"("sourceId");
ALTER TABLE "RouteEdge" ADD CONSTRAINT "RouteEdge_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "ContentSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
