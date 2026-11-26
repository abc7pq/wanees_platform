import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { databasePoolMax, prismaPgArgs, SHARED_PRISMA_KEY } from "../../packages/contracts/src/database.ts";

// One client, and so one connection pool, per server process: every Prisma module in the process (this one,
// the other app's and packages/engine's) reuses the client under SHARED_PRISMA_KEY, in production too.
const shared = globalThis as unknown as Record<string, PrismaClient | undefined>;

export const prisma: PrismaClient =
  shared[SHARED_PRISMA_KEY] ??
  (shared[SHARED_PRISMA_KEY] = new PrismaClient({
    adapter: new PrismaPg(...prismaPgArgs(process.env.DATABASE_URL ?? "postgresql://wanees:wanees_dev@localhost:5432/wanees?schema=public", { max: databasePoolMax(process.env.WANEES_DB_POOL_MAX) })),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  }));

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
