// Sends due lock-screen nudges to subscribed visitor devices. Run every minute, either in-process
// (WANEES_PUSH_DISPATCH_INTERVAL_SECONDS, see instrumentation.ts) or by an external scheduler calling
// POST /api/v1/internal/push/dispatch. Safe to run concurrently: each nudge id is claimed with a
// conditional update before it is sent, so two runners never deliver the same nudge twice.
import { prisma } from "@/lib/db";
import { computeNudges } from "@/lib/nudges";
import { loadVisitorAgentState } from "@/lib/agent-state";
import { SENT_HISTORY, mergeSent, nudgeTtlSeconds, nudgeUrgency, nudgesToSend, pushPayload } from "@/lib/push-nudges";
import { sendWebPush, vapidConfig } from "@/lib/web-push";

const MAX_FAILURES = 5;

export type DispatchSummary = { enabled: boolean; checked: number; sent: number; removed: number; failed: number };

export async function dispatchPushNudges(options: { limit?: number; now?: Date } = {}): Promise<DispatchSummary> {
  const summary: DispatchSummary = { enabled: false, checked: 0, sent: 0, removed: 0, failed: 0 };
  const vapid = vapidConfig();
  if (!vapid || !process.env.DATABASE_URL) return summary;
  summary.enabled = true;
  const now = options.now ?? new Date();
  const subscriptions = await prisma.pushSubscription.findMany({
    where: { expiresAt: { gt: now }, session: { deletedAt: null, expiresAt: { gt: now } } },
    orderBy: [{ lastCheckedAt: { sort: "asc", nulls: "first" } }],
    take: Math.min(Math.max(options.limit ?? 200, 1), 1000),
    include: { session: { include: { preferences: true, event: { select: { slug: true } } } } },
  });

  for (const subscription of subscriptions) {
    summary.checked += 1;
    const { session } = subscription;
    const state = await loadVisitorAgentState(session.event.slug, session).catch(() => null);
    const due = state
      ? nudgesToSend(computeNudges({
        site: state.site,
        plan: state.plan,
        profile: state.profile,
        nowMin: state.nowMin,
        isOpen: state.clock.isOpen !== false,
        walkingTolerance: session.preferences?.walkingTolerance,
      }), subscription.sentNudgeIds)
      : [];
    if (!state || !due.length) {
      await prisma.pushSubscription.updateMany({ where: { id: subscription.id }, data: { lastCheckedAt: now } });
      continue;
    }
    let sentIds = subscription.sentNudgeIds;
    for (const nudge of due) {
      // Claim first: only the runner whose update succeeds sends this nudge.
      const claimed = await prisma.pushSubscription.updateMany({
        where: { id: subscription.id, NOT: { sentNudgeIds: { has: nudge.id } } },
        data: { sentNudgeIds: { push: nudge.id }, lastCheckedAt: now },
      });
      if (!claimed.count) continue;
      sentIds = mergeSent(sentIds, [nudge.id]);
      const result = await sendWebPush({
        subscription: { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        payload: JSON.stringify(pushPayload(nudge, subscription.openPath)),
        vapid,
        ttlSeconds: nudgeTtlSeconds(nudge, state.nowMin),
        urgency: nudgeUrgency(nudge),
        topic: nudge.id,
      });
      if (result.gone || (!result.ok && subscription.failureCount + 1 >= MAX_FAILURES)) {
        await prisma.pushSubscription.deleteMany({ where: { id: subscription.id } });
        summary.removed += 1;
        break;
      }
      if (!result.ok) {
        // The nudge stays claimed: it is time-bound, and a retry next minute would usually arrive late.
        await prisma.pushSubscription.updateMany({ where: { id: subscription.id }, data: { failureCount: { increment: 1 } } });
        summary.failed += 1;
        break;
      }
      await prisma.pushSubscription.updateMany({
        where: { id: subscription.id },
        // Appends are atomic; the history is trimmed only once it outgrows its bound.
        data: { failureCount: 0, lastSentAt: now, ...(sentIds.length > SENT_HISTORY ? { sentNudgeIds: mergeSent(sentIds, []) } : {}) },
      });
      summary.sent += 1;
    }
  }
  return summary;
}

/** Nudges the open app already showed are marked delivered, so the lock screen does not repeat them. */
export async function markNudgesDelivered(sessionId: string, nudgeIds: readonly string[]) {
  if (!nudgeIds.length || !process.env.DATABASE_URL) return;
  const subscriptions = await prisma.pushSubscription.findMany({ where: { sessionId }, select: { id: true, sentNudgeIds: true } });
  await Promise.all(subscriptions.map((subscription) => {
    const missing = nudgeIds.filter((id) => !subscription.sentNudgeIds.includes(id));
    return missing.length
      ? prisma.pushSubscription.updateMany({ where: { id: subscription.id }, data: { sentNudgeIds: { push: missing } } })
      : null;
  }));
}
