import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadProjectEnv } from "./load-project-env.ts";
import { prismaPgArgs } from "../packages/contracts/src/database.ts";

loadProjectEnv();

if (!process.env.DATABASE_URL) {
  console.log("DATABASE_URL is not configured; database smoke test skipped.");
  process.exit(0);
}

const prisma = new PrismaClient({ adapter: new PrismaPg(...prismaPgArgs(process.env.DATABASE_URL)) });
const marker = `smoke-${randomBytes(8).toString("hex")}`;

try {
  const event = await prisma.event.findFirst({
    where: { slug: "boulevard-world-demo" },
    include: { publishedCatalogVersion: { include: { routeNodes: true, routeEdges: true, activities: true, zones: true, contentSources: true } } },
  });
  if (!event?.publishedCatalogVersion) throw new Error("Boulevard World published catalog is missing");
  if (!event.publishedCatalogVersion.routeNodes.some((node) => node.type === "ENTRANCE")) throw new Error("Published catalog has no entrance node");
  if (!event.publishedCatalogVersion.routeNodes.some((node) => node.type === "SERVICE")) throw new Error("Published catalog has no service node");
  if (!event.publishedCatalogVersion.routeEdges.length) throw new Error("Published catalog has no route graph edges");
  if (!event.publishedCatalogVersion.activities.length) throw new Error("Published catalog has no activities");
  if (!event.publishedCatalogVersion.contentSources.length || event.publishedCatalogVersion.contentSources.some((source) => source.reviewStatus !== "VERIFIED")) throw new Error("Published catalog has an unreviewed content source");
  if (event.publishedCatalogVersion.zones.some((zone) => zone.sourceRefs.length && zone.reviewStatus !== "VERIFIED")) throw new Error("Published catalog has an unreviewed imported zone");
  if (event.publishedCatalogVersion.activities.some((activity) => activity.sourceRefs.length && activity.reviewStatus !== "VERIFIED")) throw new Error("Published catalog has an unreviewed imported activity");

  const zone = await prisma.zone.findFirst({ where: { catalogVersionId: event.publishedCatalogVersion.id } });
  if (!zone) throw new Error("Published catalog has no zone for the live-update relation smoke test");
  let updateId: string | undefined;
  let snapshotId: string | undefined;
  try {
    const update = await prisma.eventUpdate.create({
      data: {
        eventId: event.id,
        updateType: "CROWD_OVERRIDE",
        targetType: "zone",
        targetId: zone.stableKey,
        payload: { level: 0.91 },
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 60_000),
      },
    });
    updateId = update.id;
    const snapshot = await prisma.crowdSnapshot.create({
      data: {
        eventId: event.id,
        eventUpdateId: update.id,
        zoneId: zone.id,
        level: 0.91,
        source: "OPERATOR",
        confidence: 1,
        observedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    snapshotId = snapshot.id;
    await prisma.eventUpdate.update({ where: { id: update.id }, data: { revokedAt: new Date(), revocationReason: "database smoke" } });
    const revoked = await prisma.eventUpdate.findUnique({ where: { id: update.id }, include: { crowdSnapshots: true } });
    if (!revoked?.revokedAt || revoked.revocationReason !== "database smoke" || revoked.crowdSnapshots[0]?.id !== snapshot.id) {
      throw new Error("Event update revocation history or crowd snapshot association did not persist");
    }
    await prisma.eventUpdate.delete({ where: { id: update.id } });
    const detachedSnapshot = await prisma.crowdSnapshot.findUnique({ where: { id: snapshot.id } });
    if (detachedSnapshot?.eventUpdateId !== null) throw new Error("Deleting an update did not safely detach its crowd snapshot");
    await prisma.crowdSnapshot.delete({ where: { id: snapshot.id } });
  } finally {
    if (updateId) await prisma.eventUpdate.deleteMany({ where: { id: updateId } });
    if (snapshotId) await prisma.crowdSnapshot.deleteMany({ where: { id: snapshotId } });
  }

  const session = await prisma.visitorSession.create({
    data: {
      publicTokenHash: marker,
      eventId: event.id,
      catalogVersionId: event.publishedCatalogVersion.id,
      locale: "ar-SA",
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const proposal = await prisma.itinerary.create({
    data: {
      sessionId: session.id,
      eventId: event.id,
      catalogVersionId: event.publishedCatalogVersion.id,
      status: "proposed",
      baseItineraryId: "smoke-base",
      baseLiveRevision: "smoke-revision",
      proposalExpiresAt: new Date(Date.now() + 60_000),
    },
  });
  if (proposal.status !== "proposed" || proposal.baseLiveRevision !== "smoke-revision") throw new Error("Proposal metadata did not persist");
  await prisma.visitorSession.delete({ where: { id: session.id } });

  const rateLimitTable = await prisma.rateLimitBucket.count();
  // Registered visitors: one record per (organization, phone), isolated between organizations,
  // and deleting a visitor removes their devices and visit records.
  const smokePhone = `+9665${String(Date.now()).slice(-8)}`;
  const otherOrg = await prisma.organization.create({ data: { name: `Smoke ${marker}`, slug: marker } });
  let visitorId: string | undefined;
  try {
    const visitor = await prisma.visitor.create({
      data: { organizationId: event.organizationId, phoneE164: smokePhone, name: "زائر اختبار", consentVersion: "smoke", consentedAt: new Date(), phoneVerifiedAt: new Date() },
    });
    visitorId = visitor.id;
    let duplicateRejected = false;
    try {
      await prisma.visitor.create({
        data: { organizationId: event.organizationId, phoneE164: smokePhone, name: "مكرر", consentVersion: "smoke", consentedAt: new Date(), phoneVerifiedAt: new Date() },
      });
    } catch (error) {
      duplicateRejected = (error as { code?: string }).code === "P2002";
    }
    if (!duplicateRejected) throw new Error("Visitor (organizationId, phoneE164) must be unique");
    const elsewhere = await prisma.visitor.create({
      data: { organizationId: otherOrg.id, phoneE164: smokePhone, name: "منظمة ثانية", consentVersion: "smoke", consentedAt: new Date(), phoneVerifiedAt: new Date() },
    });
    const visible = await prisma.visitor.count({ where: { organizationId: event.organizationId, phoneE164: smokePhone } });
    if (visible !== 1 || elsewhere.organizationId === event.organizationId) throw new Error("Visitors must stay isolated per organization");
    await prisma.visitorVisit.create({ data: { visitorId: visitor.id, eventId: event.id } });
    await prisma.visitorDevice.create({ data: { visitorId: visitor.id, tokenHash: `${marker}-device`, expiresAt: new Date(Date.now() + 60_000) } });
    await prisma.visitor.delete({ where: { id: visitor.id } });
    visitorId = undefined;
    const leftovers = await prisma.visitorVisit.count({ where: { visitorId: visitor.id } }) + await prisma.visitorDevice.count({ where: { visitorId: visitor.id } });
    if (leftovers !== 0) throw new Error("Deleting a visitor must remove their visits and devices");
  } finally {
    if (visitorId) await prisma.visitor.deleteMany({ where: { id: visitorId } });
    await prisma.organization.delete({ where: { id: otherOrg.id } });
  }

  console.log(JSON.stringify({ event: event.slug, routeNodes: event.publishedCatalogVersion.routeNodes.length, routeEdges: event.publishedCatalogVersion.routeEdges.length, activities: event.publishedCatalogVersion.activities.length, rateLimitTableRows: rateLimitTable }));
} finally {
  await prisma.$disconnect();
}
