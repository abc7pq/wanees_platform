import type { Prisma } from "@prisma/client";
import type { CrowdEvent } from "@/engine/types.ts";
import { prisma } from "@/lib/db";
import { isMeasuredCrowd, liveRevisionFor, loadCurrentCrowdSnapshots } from "@/lib/live-updates";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function activeLiveEvents(eventId: string, catalogVersionId: string, now: Date, nowMinute: number, db: Prisma.TransactionClient = prisma) {
  const [updates, latestSnapshots] = await Promise.all([
    db.eventUpdate.findMany({
      where: {
        eventId,
        revokedAt: null,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
    }),
    loadCurrentCrowdSnapshots(db, eventId, catalogVersionId, now),
  ]);

  const events: CrowdEvent[] = [];
  for (const update of updates) {
    const payload = record(update.payload);
    if (update.updateType === "CLOSURE" && update.targetType === "activity" && update.targetId) {
      events.push({ type: "cancel", activity: update.targetId });
    }
    if (update.updateType === "CLOSURE" && update.targetType === "zone" && update.targetId) {
      const zoneActivities = await db.activity.findMany({ where: { catalogVersionId, zone: { stableKey: update.targetId } }, select: { stableKey: true } });
      events.push(...zoneActivities.map((activity) => ({ type: "cancel" as const, activity: activity.stableKey })));
    }
    if (update.updateType === "DELAY" && update.targetType === "activity" && update.targetId) {
      const minutes = typeof payload.minutes === "number" ? Math.max(1, Math.min(240, Math.round(payload.minutes))) : 15;
      events.push({ type: "delay", activity: update.targetId, minutes });
    }
    if (update.updateType === "SCHEDULE_CHANGE" && update.targetType === "activity" && update.targetId && payload.cancelled === true) {
      events.push({ type: "cancel", activity: update.targetId });
    }
  }

  for (const snapshot of latestSnapshots) {
    const measured = isMeasuredCrowd(snapshot);
    if (!measured && snapshot.level < 0.75) continue;
    events.push({
      type: "crowd_spike",
      zone: snapshot.zone.stableKey,
      level: snapshot.level,
      measured,
      until_hour: Math.floor(nowMinute / 60) + 1,
    });
  }
  const snapshotSignature = latestSnapshots
    .map((snapshot) => `${snapshot.zone.stableKey}:${snapshot.level}:${snapshot.observedAt.getTime()}`)
    .sort()
    .join("|");
  const liveRevision = liveRevisionFor(updates, latestSnapshots);
  return { events, updateIds: updates.map((update) => update.id), snapshotCount: latestSnapshots.length, snapshotSignature, liveRevision };
}
