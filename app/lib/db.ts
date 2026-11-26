import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prismaPgArgs } from "../../packages/contracts/src/database.ts";

const globalForPrisma = globalThis as unknown as { waneesPrisma?: PrismaClient };

export const prisma =
  globalForPrisma.waneesPrisma ??
  new PrismaClient({
    adapter: new PrismaPg(...prismaPgArgs(process.env.DATABASE_URL ?? "postgresql://wanees:wanees_dev@localhost:5432/wanees?schema=public", { max: 30 })),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.waneesPrisma = prisma;
}

export type DatabaseHealth = { configured: boolean; reachable: boolean; catalogReady: boolean };

// `SELECT 1` on every health probe is wasteful under load; coalesce with a short TTL so the
// load-test burst doesn't queue a round-trip per request.
const HEALTH_TTL_MS = 5_000;
let healthCache: { value: DatabaseHealth; expiresAt: number } | null = null;
let healthInFlight: Promise<DatabaseHealth> | null = null;

async function checkDatabaseUncached(): Promise<DatabaseHealth> {
  if (!process.env.DATABASE_URL) {
    return { configured: false, reachable: false, catalogReady: false };
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    const rows = await prisma.$queryRaw<Array<{ ready: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM "Event" event
        INNER JOIN "CatalogVersion" catalog ON catalog.id = event."publishedCatalogVersionId"
        WHERE event.status IN ('PUBLISHED', 'LIVE')
          AND catalog.status = 'PUBLISHED'
      ) AS ready
    `;
    return { configured: true, reachable: true, catalogReady: rows[0]?.ready === true };
  } catch {
    return { configured: true, reachable: false, catalogReady: false };
  }
}

export async function checkDatabase() {
  const now = Date.now();
  if (healthCache && healthCache.expiresAt > now) return healthCache.value;
  if (healthInFlight) return healthInFlight;
  healthInFlight = checkDatabaseUncached().then((value) => {
    healthInFlight = null;
    healthCache = { value, expiresAt: Date.now() + HEALTH_TTL_MS };
    return value;
  });
  return healthInFlight;
}
