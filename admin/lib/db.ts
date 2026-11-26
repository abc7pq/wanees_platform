import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prismaPgArgs } from "../../packages/contracts/src/database.ts";

const globalForPrisma = globalThis as unknown as { waneesAdminPrisma?: PrismaClient };

export const prisma =
  globalForPrisma.waneesAdminPrisma ??
  new PrismaClient({
    adapter: new PrismaPg(...prismaPgArgs(process.env.DATABASE_URL ?? "postgresql://wanees:wanees_dev@localhost:5432/wanees?schema=public")),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.waneesAdminPrisma = prisma;
}

export async function checkDatabase() {
  if (!process.env.DATABASE_URL) return { configured: false, reachable: false, catalogReady: false };
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
