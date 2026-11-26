// Shared Prisma client for the engine package. Self-contained so both the visitor and admin
// apps can load the published catalog through `packages/engine` without depending on an app's
// own `@/lib/db` alias. Mirrors the client setup in app/lib/db.ts and admin/lib/db.ts.
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { databasePoolMax, prismaPgArgs, SHARED_PRISMA_KEY } from "../../contracts/src/database.ts";

// One client, and so one connection pool, per server process: every Prisma module in the process (this one,
// the other app's and packages/engine's) reuses the client under SHARED_PRISMA_KEY, in production too.
const shared = globalThis as unknown as Record<string, PrismaClient | undefined>;

export const prisma: PrismaClient =
  shared[SHARED_PRISMA_KEY] ??
  (shared[SHARED_PRISMA_KEY] = new PrismaClient({
    adapter: new PrismaPg(...prismaPgArgs(process.env.DATABASE_URL ?? "postgresql://wanees:wanees_dev@localhost:5432/wanees?schema=public", { max: databasePoolMax() })),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  }));
