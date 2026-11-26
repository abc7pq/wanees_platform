// Shared Prisma client for the engine package. Self-contained so both the visitor and admin
// apps can load the published catalog through `packages/engine` without depending on an app's
// own `@/lib/db` alias. Mirrors the client setup in app/lib/db.ts and admin/lib/db.ts.
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prismaPgArgs } from "../../contracts/src/database.ts";

const globalForPrisma = globalThis as unknown as { waneesEnginePrisma?: PrismaClient };

export const prisma =
  globalForPrisma.waneesEnginePrisma ??
  new PrismaClient({
    adapter: new PrismaPg(...prismaPgArgs(process.env.DATABASE_URL ?? "postgresql://wanees:wanees_dev@localhost:5432/wanees?schema=public", { max: 30 })),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.waneesEnginePrisma = prisma;
}
