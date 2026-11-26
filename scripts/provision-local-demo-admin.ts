import { randomBytes } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { DEMO_ADMIN_EMAIL, DEMO_ORGANIZATION_SLUG, isLoopbackDatabase } from "../admin/lib/local-demo.ts";
import { hashPassword, verifyPassword } from "../admin/lib/password.ts";
import { prismaPgArgs } from "../packages/contracts/src/database.ts";

const envFile = new URL("../admin/.env.local", import.meta.url);
const config = await readFile(envFile, "utf8").catch(() => "");
const { DATABASE_URL: databaseUrl } = parseEnv(config);
if (!databaseUrl || !isLoopbackDatabase(databaseUrl)) {
  throw new Error("Set a loopback PostgreSQL DATABASE_URL in admin/.env.local first.");
}

const db = new PrismaClient({ adapter: new PrismaPg(...prismaPgArgs(databaseUrl)) });
const subject = "local-demo:admin";
try {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(781403117)`;
    const organization = await tx.organization.findUnique({ where: { slug: DEMO_ORGANIZATION_SLUG } });
    if (organization?.status !== "ACTIVE") throw new Error("Seed the local demo organization before provisioning its admin.");

    const existing = await tx.user.findUnique({ where: { email: DEMO_ADMIN_EMAIL }, include: { memberships: true } });
    if (existing && (existing.externalAuthSubject !== subject
      || existing.memberships.some((membership) => membership.organizationId !== organization.id))) {
      throw new Error("The demo email is already assigned outside this local demo account.");
    }

    const currentConfig = await readFile(envFile, "utf8");
    const env = parseEnv(currentConfig);
    if (env.DATABASE_URL !== databaseUrl) throw new Error("The local database configuration changed. Run setup again.");
    const password = env.WANEES_DEMO_ADMIN_PASSWORD || randomBytes(18).toString("base64url");
    const passwordHash = existing?.passwordHash && verifyPassword(password, existing.passwordHash)
      ? existing.passwordHash
      : hashPassword(password);
    const user = await tx.user.upsert({
      where: { email: DEMO_ADMIN_EMAIL },
      create: { email: DEMO_ADMIN_EMAIL, displayName: "مدير العرض المحلي", externalAuthSubject: subject, passwordHash, status: "ACTIVE" },
      update: { passwordHash, status: "ACTIVE" },
    });
    await tx.membership.upsert({
      where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
      create: { organizationId: organization.id, userId: user.id, role: "ADMIN" },
      update: { role: "ADMIN" },
    });

    if (env.WANEES_LOCAL_DEMO !== "true" || !env.WANEES_DEMO_ADMIN_PASSWORD) {
      const retained = currentConfig.replace(/^(?:export\s+)?(?:WANEES_LOCAL_DEMO|WANEES_DEMO_ADMIN_PASSWORD)\s*=.*(?:\r?\n|$)/gm, "").trimEnd();
      const tempFile = new URL(`${envFile.href}.${process.pid}.tmp`);
      try {
        await writeFile(tempFile, `${retained}\nWANEES_LOCAL_DEMO="true"\nWANEES_DEMO_ADMIN_PASSWORD=${JSON.stringify(password)}\n`, { mode: 0o600 });
        await rename(tempFile, envFile);
      } finally {
        await rm(tempFile, { force: true });
      }
    }
  });
  console.log("Local demo admin is ready. Restart the loopback admin server and open /login for its credentials.");
} finally {
  await db.$disconnect();
}
