import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

function visibleCrowdSnapshotWhere(now: Date): Prisma.CrowdSnapshotWhereInput {
  return {
    OR: [
      { eventUpdateId: null },
      { eventUpdate: { is: { revokedAt: null, AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ] } } },
    ],
  };
}

type SnapshotCandidate = {
  source: string;
  observedAt: Date;
  zone: { catalogVersionId: string; stableKey: string };
  eventUpdate?: { payload: Prisma.JsonValue } | null;
};

export function isMeasuredCrowd(snapshot: SnapshotCandidate) {
  const payload = snapshot.eventUpdate?.payload;
  const counted = payload && typeof payload === "object" && !Array.isArray(payload) && payload.measurement === "counted";
  return Boolean(counted || snapshot.source === "SENSOR" || snapshot.source === "INTEGRATION");
}

function crowdSourcePriority(snapshot: SnapshotCandidate) {
  // An active operator update (crowd override / counted observation) is a deliberate decision
  // and wins over passive device sensing while its window is open.
  if (snapshot.eventUpdate) return 4;
  if (isMeasuredCrowd(snapshot)) return 3;
  if (snapshot.source === "OPERATOR") return 2;
  return 1;
}

export function latestCrowdSnapshots<T extends SnapshotCandidate>(snapshots: T[], catalogVersionId: string) {
  const selected = new Map<string, T>();
  const ordered = [...snapshots]
    .filter((snapshot) => snapshot.zone.catalogVersionId === catalogVersionId)
    .sort((left, right) =>
      crowdSourcePriority(right) - crowdSourcePriority(left)
      || right.observedAt.getTime() - left.observedAt.getTime()
      || left.zone.stableKey.localeCompare(right.zone.stableKey),
    );
  for (const snapshot of ordered) {
    if (!selected.has(snapshot.zone.stableKey)) selected.set(snapshot.zone.stableKey, snapshot);
  }
  return [...selected.values()];
}

export async function loadCurrentCrowdSnapshots(db: Prisma.TransactionClient, eventId: string, catalogVersionId: string, now: Date) {
  const snapshots = await db.crowdSnapshot.findMany({
    where: {
      eventId,
      zone: { catalogVersionId },
      observedAt: { lte: now },
      AND: [
        { OR: [{ expiresAt: { gt: now } }, { expiresAt: null, observedAt: { gte: new Date(now.getTime() - 60 * 60_000) } }] },
        visibleCrowdSnapshotWhere(now),
      ],
    },
    orderBy: [{ observedAt: "desc" }, { id: "desc" }],
    take: 200,
    include: { zone: true, eventUpdate: { select: { payload: true } } },
  });
  return latestCrowdSnapshots(snapshots, catalogVersionId);
}

export function liveRevisionFor(
  updates: { id: string; createdAt: Date }[],
  snapshots: (SnapshotCandidate & { level: number })[],
) {
  const entries = [
    ...updates.map(({ id, createdAt }) => `update:${id}:${createdAt.getTime()}`),
    ...snapshots.map(({ zone, level, observedAt }) => `crowd:${zone.stableKey}:${level}:${observedAt.getTime()}`),
  ].sort();
  return createHash("sha256").update(entries.join("|")).digest("hex").slice(0, 20);
}
