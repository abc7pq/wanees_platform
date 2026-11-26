import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { FEATURE_FLAGS } from "../packages/contracts/src/index.ts";
import { loadProjectEnv } from "./load-project-env.ts";
import { prismaPgArgs } from "../packages/contracts/src/database.ts";

loadProjectEnv();

const HELP = `Usage: npm run db:retention -- [--dry-run | --apply]

Deletes operational history older than the configured windows:
  CrowdSnapshot  by observedAt  (default 90 days)
  EventUpdate    by createdAt   (default 365 days; only ended or revoked rows)

The default is a dry run: it prints what would be deleted and never issues a
DELETE. Pass --apply, or set WANEES_RETENTION_APPLY=true, to delete rows.

An EventUpdate with endsAt in the future or null and no revokedAt is still live,
so age alone never deletes it.

Environment:
  WANEES_RETENTION_CROWD_SNAPSHOT_DAYS  integer 1-3650 (default 90)
  WANEES_RETENTION_EVENT_UPDATE_DAYS    integer 1-3650 (default 365)
  WANEES_RETENTION_APPLY                true/1/yes/on to enable deletion
  ${FEATURE_FLAGS.retentionJob}         false/0/off disables the job entirely
`;

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}

const knownArgs = new Set(["--dry-run", "--apply", "--help", "-h"]);
const unknownArgs = args.filter((arg) => !knownArgs.has(arg));
if (unknownArgs.length > 0) {
  console.error(`Unknown argument(s): ${unknownArgs.join(", ")}\n\n${HELP}`);
  process.exit(1);
}

const retentionEnabled = process.env[FEATURE_FLAGS.retentionJob]?.trim().toLowerCase();
if (retentionEnabled === "0" || retentionEnabled === "false" || retentionEnabled === "off") {
  console.log(JSON.stringify({ mode: "disabled", reason: `${FEATURE_FLAGS.retentionJob} is disabled` }, null, 2));
  process.exit(0);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required for the retention policy. Set it in the environment or a project env file.");
  process.exit(1);
}

function isEnabled(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

function readDays(name: string, fallback: number) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3650) {
    throw new Error(`${name} must be an integer between 1 and 3650; received "${raw}".`);
  }
  return parsed;
}

const apply = args.includes("--apply") || isEnabled(process.env.WANEES_RETENTION_APPLY);
const crowdSnapshotDays = readDays("WANEES_RETENTION_CROWD_SNAPSHOT_DAYS", 90);
const eventUpdateDays = readDays("WANEES_RETENTION_EVENT_UPDATE_DAYS", 365);
const batchSize = 1_000;

const now = new Date();
const crowdSnapshotCutoff = new Date(now.getTime() - crowdSnapshotDays * 86_400_000);
const eventUpdateCutoff = new Date(now.getTime() - eventUpdateDays * 86_400_000);

const prisma = new PrismaClient({
  adapter: new PrismaPg(...prismaPgArgs(databaseUrl)),
});

type TableResult = {
  table: "CrowdSnapshot" | "EventUpdate";
  timestampColumn: "observedAt" | "createdAt";
  retentionDays: number;
  cutoff: string;
  matched: number;
  deleted: number;
  sample: Array<{ id: string; timestamp: string }>;
};

async function purgeCrowdSnapshots(): Promise<TableResult> {
  const where = { observedAt: { lt: crowdSnapshotCutoff } };
  const matched = await prisma.crowdSnapshot.count({ where });
  if (!apply) {
    const sample = await prisma.crowdSnapshot.findMany({
      where,
      select: { id: true, observedAt: true },
      orderBy: { observedAt: "asc" },
      take: 5,
    });
    return {
      table: "CrowdSnapshot",
      timestampColumn: "observedAt",
      retentionDays: crowdSnapshotDays,
      cutoff: crowdSnapshotCutoff.toISOString(),
      matched,
      deleted: 0,
      sample: sample.map((row) => ({ id: row.id, timestamp: row.observedAt.toISOString() })),
    };
  }

  let deleted = 0;
  for (;;) {
    const batch = await prisma.crowdSnapshot.findMany({
      where,
      select: { id: true },
      orderBy: { observedAt: "asc" },
      take: batchSize,
    });
    if (batch.length === 0) break;
    const result = await prisma.crowdSnapshot.deleteMany({ where: { id: { in: batch.map((row) => row.id) } } });
    deleted += result.count;
    if (batch.length < batchSize) break;
  }
  return {
    table: "CrowdSnapshot",
    timestampColumn: "observedAt",
    retentionDays: crowdSnapshotDays,
    cutoff: crowdSnapshotCutoff.toISOString(),
    matched,
    deleted,
    sample: [],
  };
}

async function purgeEventUpdates(): Promise<TableResult> {
  // Retention must not change live behavior: an old update that has no end and
  // was never revoked may be a permanent closure, so only ended or revoked rows
  // are eligible.
  const where = {
    createdAt: { lt: eventUpdateCutoff },
    OR: [{ revokedAt: { not: null } }, { endsAt: { lt: now } }],
  };
  const matched = await prisma.eventUpdate.count({ where });
  if (!apply) {
    const sample = await prisma.eventUpdate.findMany({
      where,
      select: { id: true, createdAt: true },
      orderBy: { createdAt: "asc" },
      take: 5,
    });
    return {
      table: "EventUpdate",
      timestampColumn: "createdAt",
      retentionDays: eventUpdateDays,
      cutoff: eventUpdateCutoff.toISOString(),
      matched,
      deleted: 0,
      sample: sample.map((row) => ({ id: row.id, timestamp: row.createdAt.toISOString() })),
    };
  }

  let deleted = 0;
  for (;;) {
    const batch = await prisma.eventUpdate.findMany({
      where,
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: batchSize,
    });
    if (batch.length === 0) break;
    const result = await prisma.eventUpdate.deleteMany({ where: { id: { in: batch.map((row) => row.id) } } });
    deleted += result.count;
    if (batch.length < batchSize) break;
  }
  return {
    table: "EventUpdate",
    timestampColumn: "createdAt",
    retentionDays: eventUpdateDays,
    cutoff: eventUpdateCutoff.toISOString(),
    matched,
    deleted,
    sample: [],
  };
}

const startedAt = Date.now();
try {
  // Snapshots first: deleting an EventUpdate detaches any snapshot that still
  // references it (ON DELETE SET NULL), so the age rule for snapshots must run
  // against the original references.
  const tables = [await purgeCrowdSnapshots(), await purgeEventUpdates()];
  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        generatedAt: now.toISOString(),
        batchSize,
        tables,
        note: apply
          ? "Rows older than each cutoff were deleted in batches."
          : "No rows were deleted. Re-run with --apply or set WANEES_RETENTION_APPLY=true to delete.",
        durationMs: Date.now() - startedAt,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
