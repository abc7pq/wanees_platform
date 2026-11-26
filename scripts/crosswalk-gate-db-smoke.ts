// Proves the database itself holds the crosswalk gate, without the app:
// raw SQL cannot publish a HOLD draft, point an event at it, mark it
// VERIFIED without a valid checksum, or mark it NOT_REQUIRED; and an edit to
// a VERIFIED draft drops it back to HOLD. Everything runs inside one
// transaction that is always rolled back, so it leaves no rows behind.
// Run only against a disposable database.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadProjectEnv } from "./load-project-env.ts";
import { prismaPgArgs } from "../packages/contracts/src/database.ts";

loadProjectEnv();
const db = new PrismaClient({ adapter: new PrismaPg(...prismaPgArgs(process.env.DATABASE_URL)) });
const rollback = new Error("ROLLBACK_SMOKE");
const good = "a".repeat(64);
const results: Array<{ case: string; result: string }> = [];
const before = await db.catalogVersion.count();

try {
  await db.$transaction(async (tx) => {
    const sql = (text: string, ...values: unknown[]) => tx.$executeRawUnsafe(text, ...values);
    const one = async <T>(text: string, ...values: unknown[]) => ((await tx.$queryRawUnsafe(text, ...values)) as T[])[0];

    async function refused(name: string, pattern: RegExp, text: string, ...values: unknown[]) {
      await sql("SAVEPOINT crosswalk_case");
      try {
        await sql(text, ...values);
      } catch (error) {
        await sql("ROLLBACK TO SAVEPOINT crosswalk_case");
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, pattern, `${name}: refused for the wrong reason: ${message}`);
        results.push({ case: name, result: "refused" });
        return;
      }
      throw new Error(`${name}: the database accepted it`);
    }

    const event = await one<{ id: string; publishedCatalogVersionId: string }>(
      `SELECT "id", "publishedCatalogVersionId" FROM "Event" WHERE "publishedCatalogVersionId" IS NOT NULL ORDER BY "createdAt" LIMIT 1`);
    assert.ok(event, "needs one seeded event with a published catalog");
    const { next } = await one<{ next: number }>(`SELECT COALESCE(MAX("versionNumber"), 0) + 1000 AS next FROM "CatalogVersion" WHERE "eventId" = $1`, event.id);
    const draft = `smoke-${randomUUID()}`;
    await sql(`INSERT INTO "CatalogVersion" ("id", "eventId", "versionNumber") VALUES ($1, $2, $3)`, draft, event.id, next);
    const status = () => one<{ crosswalkStatus: string; crosswalkChecksum: string | null }>(
      `SELECT "crosswalkStatus"::text, "crosswalkChecksum" FROM "CatalogVersion" WHERE "id" = $1`, draft);
    assert.equal((await status()).crosswalkStatus, "HOLD", "a new draft starts on HOLD");
    results.push({ case: "new draft defaults to HOLD", result: "ok" });

    await refused("publish a HOLD draft", /CROSSWALK_HOLD/, `UPDATE "CatalogVersion" SET "status" = 'PUBLISHED' WHERE "id" = $1`, draft);
    await refused("point the event at a HOLD draft", /CROSSWALK_HOLD/, `UPDATE "Event" SET "publishedCatalogVersionId" = $1 WHERE "id" = $2`, draft, event.id);
    await refused("VERIFIED without a checksum", /CatalogVersion_crosswalk_verified_checksum/, `UPDATE "CatalogVersion" SET "crosswalkStatus" = 'VERIFIED' WHERE "id" = $1`, draft);
    await refused("VERIFIED with a malformed checksum", /CatalogVersion_crosswalk_verified_checksum/, `UPDATE "CatalogVersion" SET "crosswalkStatus" = 'VERIFIED', "crosswalkChecksum" = 'not-a-sha' WHERE "id" = $1`, draft);
    await refused("mark a HOLD draft NOT_REQUIRED", /CROSSWALK_NOT_REQUIRED_FORBIDDEN/, `UPDATE "CatalogVersion" SET "crosswalkStatus" = 'NOT_REQUIRED' WHERE "id" = $1`, draft);
    await refused("insert a NOT_REQUIRED draft", /CROSSWALK_NOT_REQUIRED_FORBIDDEN/,
      `INSERT INTO "CatalogVersion" ("id", "eventId", "versionNumber", "crosswalkStatus") VALUES ($1, $2, $3, 'NOT_REQUIRED')`, `smoke-${randomUUID()}`, event.id, next + 1);
    await refused("insert a published catalog on HOLD", /CROSSWALK_HOLD/,
      `INSERT INTO "CatalogVersion" ("id", "eventId", "versionNumber", "status") VALUES ($1, $2, $3, 'PUBLISHED')`, `smoke-${randomUUID()}`, event.id, next + 2);

    await sql(`UPDATE "CatalogVersion" SET "crosswalkStatus" = 'VERIFIED', "crosswalkChecksum" = $2 WHERE "id" = $1`, draft, good);
    await sql(`INSERT INTO "Zone" ("id", "catalogVersionId", "stableKey", "nameAr", "mapX", "mapY") VALUES ($1, $2, 'smoke-zone', 'منطقة', 0, 0)`, `smoke-${randomUUID()}`, draft);
    assert.deepEqual(await status(), { crosswalkStatus: "HOLD", crosswalkChecksum: null }, "an edit must drop VERIFIED to HOLD");
    results.push({ case: "zone insert on a VERIFIED draft drops it to HOLD", result: "ok" });

    await sql(`UPDATE "CatalogVersion" SET "crosswalkStatus" = 'VERIFIED', "crosswalkChecksum" = $2 WHERE "id" = $1`, draft, good);
    await sql(`UPDATE "Zone" SET "nameAr" = 'منطقة معدلة' WHERE "catalogVersionId" = $1`, draft);
    assert.equal((await status()).crosswalkStatus, "HOLD", "a zone update must drop VERIFIED to HOLD");
    results.push({ case: "zone update on a VERIFIED draft drops it to HOLD", result: "ok" });

    await sql(`UPDATE "CatalogVersion" SET "crosswalkStatus" = 'VERIFIED', "crosswalkChecksum" = $2 WHERE "id" = $1`, draft, good);
    await sql(`UPDATE "CatalogVersion" SET "status" = 'PUBLISHED' WHERE "id" = $1`, draft);
    results.push({ case: "a VERIFIED draft can be published (control)", result: "ok" });
    throw rollback;
  }, { timeout: 30_000 });
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  const after = await db.catalogVersion.count();
  await db.$disconnect();
  assert.equal(after, before, "the smoke must leave no catalog versions behind");
}
console.table(results);
console.log(`Crosswalk database gate: ${results.length} cases passed, all changes rolled back.`);
