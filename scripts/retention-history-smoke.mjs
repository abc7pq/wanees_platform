import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadProjectEnv } from "./load-project-env.ts";

loadProjectEnv();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required for the retention smoke test.");
  process.exit(1);
}

const DAY = 86_400_000;
const BATCH_SCRIPT = "scripts/retention-history.ts";
const marker = `retention-smoke-${Date.now()}-${randomBytes(3).toString("hex")}`;
const now = Date.now();
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runRetention(args, env = {}) {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", BATCH_SCRIPT, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl, ...env },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`retention script exited ${result.status}: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

function tableByName(report, name) {
  const table = report.tables.find((entry) => entry.table === name);
  assert(table, `report is missing ${name}`);
  return table;
}

const oldUpdateDate = new Date(now - 400 * DAY);
const newUpdateDate = new Date(now - 30 * DAY);
const oldSnapshotDate = new Date(now - 100 * DAY);
const newSnapshotDate = new Date(now - 10 * DAY);

const ids = { oldUpdate: null, newUpdate: null, activeOldUpdate: null, oldSnapshot: null, newSnapshot: null };

try {
  const event = await prisma.event.findFirst({
    where: { slug: "boulevard-world-demo" },
    select: { id: true },
  });
  assert(event, "demo event boulevard-world-demo is missing; run npm run db:seed first");

  const zone = await prisma.zone.findFirst({
    where: { catalogVersion: { is: { eventId: event.id } } },
    select: { id: true },
  });
  assert(zone, "demo event has no zone; run npm run db:seed first");

  const preExistingSnapshots = await prisma.crowdSnapshot.count({
    where: { observedAt: { lt: new Date(now - 90 * DAY) } },
  });
  const preExistingUpdates = await prisma.eventUpdate.count({
    where: {
      createdAt: { lt: new Date(now - 365 * DAY) },
      OR: [{ revokedAt: { not: null } }, { endsAt: { lt: new Date(now) } }],
    },
  });
  assert(
    preExistingSnapshots === 0 && preExistingUpdates === 0,
    `refusing to run: the database already holds ${preExistingSnapshots} snapshot(s) and ${preExistingUpdates} update(s) older than the default cutoffs. Use a demo or scratch database.`,
  );

  const oldUpdate = await prisma.eventUpdate.create({
    data: {
      eventId: event.id,
      updateType: "CROWD_OVERRIDE",
      targetType: "zone",
      targetId: zone.id,
      payload: { retentionSmoke: marker },
      createdAt: oldUpdateDate,
      endsAt: new Date(now - 399 * DAY),
    },
  });
  ids.oldUpdate = oldUpdate.id;

  const newUpdate = await prisma.eventUpdate.create({
    data: {
      eventId: event.id,
      updateType: "CROWD_OVERRIDE",
      targetType: "zone",
      targetId: zone.id,
      payload: { retentionSmoke: marker },
      createdAt: newUpdateDate,
      endsAt: new Date(now + 30 * DAY),
    },
  });
  ids.newUpdate = newUpdate.id;

  // Still live: old by createdAt, no end and never revoked. Age alone must not
  // delete it, or a permanent closure would silently reopen.
  const activeOldUpdate = await prisma.eventUpdate.create({
    data: {
      eventId: event.id,
      updateType: "CLOSURE",
      targetType: "zone",
      targetId: zone.id,
      payload: { retentionSmoke: marker },
      createdAt: oldUpdateDate,
      endsAt: null,
    },
  });
  ids.activeOldUpdate = activeOldUpdate.id;

  const oldSnapshot = await prisma.crowdSnapshot.create({
    data: {
      eventId: event.id,
      zoneId: zone.id,
      eventUpdateId: oldUpdate.id,
      level: 0.42,
      source: "SIMULATED",
      confidence: 1,
      observedAt: oldSnapshotDate,
      expiresAt: new Date(now - 99 * DAY),
    },
  });
  ids.oldSnapshot = oldSnapshot.id;

  const newSnapshot = await prisma.crowdSnapshot.create({
    data: {
      eventId: event.id,
      zoneId: zone.id,
      eventUpdateId: newUpdate.id,
      level: 0.43,
      source: "SIMULATED",
      confidence: 1,
      observedAt: newSnapshotDate,
      expiresAt: new Date(now - 9 * DAY),
    },
  });
  ids.newSnapshot = newSnapshot.id;

  const countTestRows = async () => ({
    snapshots: await prisma.crowdSnapshot.count({ where: { id: { in: [ids.oldSnapshot, ids.newSnapshot] } } }),
    updates: await prisma.eventUpdate.count({
      where: { id: { in: [ids.oldUpdate, ids.newUpdate, ids.activeOldUpdate] } },
    }),
  });

  const beforeDryRun = await countTestRows();
  assert(beforeDryRun.snapshots === 2 && beforeDryRun.updates === 3, "failed to create the five test rows");

  const dryRun = runRetention(["--dry-run"]);
  assert(dryRun.mode === "dry-run", `dry-run reported mode ${dryRun.mode}`);
  assert(dryRun.tables.every((entry) => entry.deleted === 0), "dry-run reported a deletion");
  assert(tableByName(dryRun, "CrowdSnapshot").matched === 1, "dry-run did not match exactly the old snapshot");
  assert(tableByName(dryRun, "EventUpdate").matched === 1, "dry-run did not match exactly the old update");
  const afterDryRun = await countTestRows();
  assert(afterDryRun.snapshots === 2 && afterDryRun.updates === 3, "dry-run changed row counts");

  const override = runRetention(["--dry-run"], {
    WANEES_RETENTION_CROWD_SNAPSHOT_DAYS: "120",
    WANEES_RETENTION_EVENT_UPDATE_DAYS: "500",
  });
  assert(tableByName(override, "CrowdSnapshot").matched === 0, "140-day snapshot was matched under a 120-day window");
  assert(tableByName(override, "EventUpdate").matched === 0, "400-day update was matched under a 500-day window");

  const disabled = runRetention(["--dry-run"], { WANEES_FEATURE_RETENTION_JOB: "false" });
  assert(disabled.mode === "disabled", "the retention feature flag did not skip the job");
  assert((await countTestRows()).snapshots === 2, "disabled job changed snapshot rows");

  const invalid = spawnSync(process.execPath, ["--experimental-strip-types", BATCH_SCRIPT, "--dry-run"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl, WANEES_RETENTION_CROWD_SNAPSHOT_DAYS: "0" },
    encoding: "utf8",
  });
  assert(invalid.status !== 0, "an invalid retention window was accepted");
  assert(
    `${invalid.stderr}${invalid.stdout}`.includes("between 1 and 3650"),
    "invalid window error did not explain the accepted range",
  );

  const applied = runRetention(["--apply"]);
  assert(applied.mode === "apply", `apply reported mode ${applied.mode}`);
  assert(tableByName(applied, "CrowdSnapshot").deleted === 1, "apply did not delete exactly one snapshot");
  assert(tableByName(applied, "EventUpdate").deleted === 1, "apply did not delete exactly one update");

  const oldSnapshotAfter = await prisma.crowdSnapshot.findUnique({ where: { id: ids.oldSnapshot } });
  const oldUpdateAfter = await prisma.eventUpdate.findUnique({ where: { id: ids.oldUpdate } });
  const newSnapshotAfter = await prisma.crowdSnapshot.findUnique({ where: { id: ids.newSnapshot } });
  const newUpdateAfter = await prisma.eventUpdate.findUnique({ where: { id: ids.newUpdate } });
  const activeOldUpdateAfter = await prisma.eventUpdate.findUnique({ where: { id: ids.activeOldUpdate } });
  assert(oldSnapshotAfter === null, "old snapshot survived apply");
  assert(oldUpdateAfter === null, "old update survived apply");
  assert(newSnapshotAfter !== null, "new snapshot was deleted by apply");
  assert(newUpdateAfter !== null, "new update was deleted by apply");
  assert(activeOldUpdateAfter !== null, "an old update that is still live was deleted by apply");

  console.log(
    JSON.stringify(
      {
        ok: true,
        marker,
        dryRun: { deleted: 0, matched: { snapshots: 1, updates: 1 }, rowCountsUnchanged: true },
        envOverride: { snapshotDays: 120, updateDays: 500, matched: 0 },
        featureFlagDisabled: true,
        invalidWindowRejected: true,
        apply: { deleted: { snapshots: 1, updates: 1 }, kept: { newSnapshot: true, newUpdate: true, activeOldUpdate: true } },
        demoEvent: event.id,
      },
      null,
      2,
    ),
  );
} finally {
  await prisma.crowdSnapshot
    .deleteMany({ where: { id: { in: [ids.oldSnapshot, ids.newSnapshot].filter(Boolean) } } })
    .catch(() => {});
  await prisma.eventUpdate
    .deleteMany({ where: { id: { in: [ids.oldUpdate, ids.newUpdate, ids.activeOldUpdate].filter(Boolean) } } })
    .catch(() => {});
  await prisma.$disconnect();
}
