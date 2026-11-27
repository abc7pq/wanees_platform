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

// Registered visitors (name + verified phone) are removed after this many days without a visit.
const visitorRetentionDays = (() => {
  const parsed = Number.parseInt(process.env.WANEES_RETENTION_VISITOR_DAYS ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 365;
})();

const now = new Date();
const visitorCutoff = new Date(now.getTime() - visitorRetentionDays * 24 * 60 * 60 * 1000);
try {
  const [conversationTurns, sessions, rateLimitBuckets, presencePings, pushSubscriptions, otpChallenges, visitorDevices, inactiveVisitors, guestProfiles, linkGrants] = await Promise.all([
    prisma.conversationTurn.deleteMany({ where: { retentionExpiresAt: { lt: now } } }),
    prisma.visitorSession.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.rateLimitBucket.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.presencePing.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.pushSubscription.deleteMany({ where: { expiresAt: { lt: now } } }),
    // OTP challenges hold a pending name and phone; keep them only until they expire.
    prisma.visitorOtpChallenge.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.visitorDevice.deleteMany({ where: { expiresAt: { lt: now } } }),
    // Cascades to the visitor's devices and visit records.
    prisma.visitor.deleteMany({ where: { lastSeenAt: { lt: visitorCutoff } } }),
    // Opt-in anonymous guest profiles: removed once the visitor deleted them, or after the same
    // inactivity window (their cookie lives a year; updatedAt moves on every visit).
    prisma.guestProfile.deleteMany({ where: { OR: [{ deletedAt: { not: null } }, { updatedAt: { lt: visitorCutoff } }] } }),
    // Phone ↔ screen links: ended ones and unused expired codes (the rest go with their session).
    prisma.visitorLinkGrant.deleteMany({ where: { OR: [{ revokedAt: { not: null } }, { redeemedAt: null, expiresAt: { lt: now } }] } }),
  ]);
  console.log(JSON.stringify({
    conversationTurns: conversationTurns.count,
    sessions: sessions.count,
    rateLimitBuckets: rateLimitBuckets.count,
    presencePings: presencePings.count,
    pushSubscriptions: pushSubscriptions.count,
    otpChallenges: otpChallenges.count,
    visitorDevices: visitorDevices.count,
    inactiveVisitors: inactiveVisitors.count,
    guestProfiles: guestProfiles.count,
    linkGrants: linkGrants.count,
    visitorRetentionDays,
  }));
} finally {
  await prisma.$disconnect();
}
