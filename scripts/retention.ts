import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { FEATURE_FLAGS } from "../packages/contracts/src/index.ts";
import { loadProjectEnv } from "./load-project-env.ts";
import { prismaPgArgs } from "../packages/contracts/src/database.ts";

loadProjectEnv();

const retentionEnabled = process.env[FEATURE_FLAGS.retentionJob]?.trim().toLowerCase();
if (retentionEnabled === "0" || retentionEnabled === "false" || retentionEnabled === "off") {
  console.log("Retention feature flag is disabled; cleanup skipped.");
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.log("DATABASE_URL is not configured; retention cleanup skipped.");
  process.exit(0);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg(...prismaPgArgs(process.env.DATABASE_URL)),
});

const now = new Date();
try {
  const [conversationTurns, sessions, rateLimitBuckets, presencePings, pushSubscriptions] = await Promise.all([
    prisma.conversationTurn.deleteMany({ where: { retentionExpiresAt: { lt: now } } }),
    prisma.visitorSession.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.rateLimitBucket.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.presencePing.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.pushSubscription.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);
  console.log(JSON.stringify({ conversationTurns: conversationTurns.count, sessions: sessions.count, rateLimitBuckets: rateLimitBuckets.count, presencePings: presencePings.count, pushSubscriptions: pushSubscriptions.count }));
} finally {
  await prisma.$disconnect();
}
