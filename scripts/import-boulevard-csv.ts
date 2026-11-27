import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadProjectEnv } from "./load-project-env.ts";
import { normalizeCatalogRows, parseCsv } from "./catalog-csv.ts";
import { prismaPgArgs } from "../packages/contracts/src/database.ts";
import { suggestActivityTags } from "../admin/lib/activity-content.ts";

loadProjectEnv();

function argument(name: string, fallback?: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const csvArgument = argument("--csv");
if (!csvArgument) throw new Error("Usage: npm run catalog:import -- --csv <path> [--event-slug boulevard-world-demo] [--apply]");
const csvPath = resolve(csvArgument);
const csvText = await readFile(csvPath, "utf8");
const checksum = createHash("sha256").update(csvText).digest("hex");
const normalized = normalizeCatalogRows(parseCsv(csvText));
if (normalized.errors.length) {
  console.error(JSON.stringify({ valid: false, errors: normalized.errors }, null, 2));
  process.exit(1);
}

const summary = { file: basename(csvPath), checksum, ...normalized.summary, draftOnly: true, reviewRequired: true, mapGeometryImported: false, schedulesImported: false };
console.log(JSON.stringify(summary, null, 2));
if (!process.argv.includes("--apply")) {
  console.log("Dry run only. Pass --apply to create a new PostgreSQL draft catalog; the published catalog is never replaced by this command.");
  process.exit(0);
}

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required. The importer never writes without PostgreSQL.");
const eventSlug = argument("--event-slug", "boulevard-world-demo")!;
const organizationSlug = process.env.WANEES_ORGANIZATION_SLUG ?? "wanees-demo";
const db = new PrismaClient({ adapter: new PrismaPg(...prismaPgArgs(process.env.DATABASE_URL)) });
try {
  const event = await db.event.findFirst({ where: { slug: eventSlug, organization: { slug: organizationSlug } }, select: { id: true, organizationId: true, name: true } });
  if (!event) throw new Error(`Event not found in organization ${organizationSlug}: ${eventSlug}`);
  const created = await db.$transaction(async (tx) => {
    const maxVersion = await tx.catalogVersion.aggregate({ where: { eventId: event.id }, _max: { versionNumber: true } });
    const version = await tx.catalogVersion.create({
      data: {
        eventId: event.id,
        versionNumber: (maxVersion._max.versionNumber ?? 0) + 1,
        status: "DRAFT",
        sourceSummary: `Candidate CSV import: ${basename(csvPath)} · ${normalized.summary.records} records · review required`,
        config: { import: { ...summary, importedAt: new Date().toISOString(), sourcePrecedence: "candidate" } },
      },
    });
    const source = await tx.contentSource.create({
      data: {
        catalogVersionId: version.id,
        sourceType: "csv_candidate",
        title: `Boulevard World CSV candidate — ${basename(csvPath)}`,
        locator: basename(csvPath),
        checksum,
        observedAt: new Date(),
        trustLevel: "candidate",
        reviewStatus: "UNREVIEWED",
      },
    });
    const zoneIds = new Map<string, string>();
    for (const zone of normalized.zones) {
      const createdZone = await tx.zone.create({
        data: {
          catalogVersionId: version.id,
          stableKey: zone.stableKey,
          nameAr: zone.nameAr,
          mapX: 0,
          mapY: 0,
          tags: ["csv-import", "needs-map-review"],
          status: "ACTIVE",
          reviewStatus: "UNREVIEWED",
          sourceRefs: [source.id],
        },
      });
      zoneIds.set(zone.stableKey, createdZone.id);
    }
    for (const activity of normalized.activities) {
      const zoneId = zoneIds.get(activity.zoneStableKey);
      if (!zoneId) throw new Error(`Normalized zone missing for ${activity.stableKey}`);
      await tx.activity.create({
        data: {
          catalogVersionId: version.id,
          zoneId,
          stableKey: activity.stableKey,
          nameAr: activity.nameAr,
          nameEn: activity.nameEn,
          descriptionAr: activity.descriptionAr,
          // Imported rows get suggested tags only; an organizer approves them before matching uses them.
          tagSuggestions: suggestActivityTags({ nameAr: activity.nameAr, nameEn: activity.nameEn, descriptionAr: activity.descriptionAr, tags: [] }),
          type: activity.type,
          durationMin: activity.durationMin,
          priceMinCents: activity.priceSar === null ? null : Math.round(activity.priceSar * 100),
          priceMaxCents: activity.priceSar === null ? null : Math.round(activity.priceSar * 100),
          ageMin: activity.ageMin,
          familyFriendly: activity.familyFriendly,
          interests: activity.interests,
          reviewStatus: "UNREVIEWED",
          sourceRefs: [source.id],
        },
      });
    }
    await tx.auditLog.create({
      data: {
        organizationId: event.organizationId,
        action: "catalog_version.import_candidate",
        entityType: "CatalogVersion",
        entityId: version.id,
        afterSummary: { ...summary, versionNumber: version.versionNumber, sourceId: source.id },
      },
    });
    return { versionId: version.id, versionNumber: version.versionNumber, sourceId: source.id, activities: normalized.summary.records, zones: normalized.summary.rawZones };
  });
  console.log(JSON.stringify({ applied: true, event: event.name, ...created }, null, 2));
} finally {
  await db.$disconnect();
}
