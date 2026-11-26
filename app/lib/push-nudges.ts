// Lock-screen nudges: pure helpers shared by the subscribe API, the dispatcher and the tests.
// The nudge itself (what to say, when) comes from computeNudges; this file only decides which ones a
// device still needs and what the encrypted notification carries. No LLM and no visitor identity here.
import { z } from "zod";
import type { Nudge } from "./nudges.ts";

/** How many delivered nudge ids a subscription remembers (enough for one visit, bounded in size). */
export const SENT_HISTORY = 40;
/** Nudges per device per dispatcher pass: one is the norm, two when a show and the visit end coincide. */
export const MAX_PER_PASS = 2;

const nudgeIdSchema = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9_:.-]+$/);

export const pushSubscribeSchema = z.object({
  subscription: z.object({
    endpoint: z.string().trim().url().max(1024),
    expirationTime: z.number().nullish(),
    keys: z.object({
      p256dh: z.string().trim().regex(/^[A-Za-z0-9_-]{80,100}$/),
      auth: z.string().trim().regex(/^[A-Za-z0-9_-]{16,32}$/),
    }).strict(),
  }).strict(),
  /** The page the notification reopens; only visitor guide paths on this origin. */
  openPath: z.string().trim().max(200).regex(/^\/(?:demo|events\/[A-Za-z0-9_-]{1,120})$/).default("/demo"),
  /** Nudges the app already showed, so the lock screen does not repeat them. */
  seenNudgeIds: z.array(nudgeIdSchema).max(20).default([]),
}).strict();

export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().trim().url().max(1024),
}).strict();

/** Nudges this device has not received yet, in the order computeNudges ranks them. */
export function nudgesToSend(nudges: readonly Nudge[], sent: readonly string[], max = MAX_PER_PASS) {
  const seen = new Set(sent);
  return nudges.filter((nudge) => !seen.has(nudge.id)).slice(0, max);
}

/** Merge newly delivered ids into the bounded history (newest last, no duplicates). */
export function mergeSent(sent: readonly string[], ids: readonly string[]) {
  const merged = [...sent.filter((id) => !ids.includes(id)), ...ids];
  return merged.slice(-SENT_HISTORY);
}

const TITLES: Record<Nudge["kind"], string> = {
  show_soon: "العرض بيبدأ قريب",
  leave_now: "وقت التحرك",
  visit_ending: "زيارتك قربت تخلص",
};

/**
 * Seconds the push service may hold the message. A nudge is worthless once its moment has passed: the
 * last id segment is the show start or visit end (event minutes), so the TTL ends there.
 */
export function nudgeTtlSeconds(nudge: Nudge, nowMin: number) {
  const deadline = Number(nudge.id.split(":").at(-1));
  if (!Number.isFinite(deadline)) return 300;
  return Math.max(60, Math.min(1800, Math.round((deadline - nowMin) * 60)));
}

export type PushNotificationPayload = {
  v: 1;
  id: string;
  kind: Nudge["kind"];
  title: string;
  body: string;
  url: string;
  targetId?: string;
  actions: Array<{ action: "get_directions" | "show_on_map" | "shorten_plan"; title: string }>;
};

/** What the service worker shows. Plain text only; the page re-reads the nudge from the API on open. */
export function pushPayload(nudge: Nudge, openPath: string): PushNotificationPayload {
  const url = `${openPath}?nudge=${encodeURIComponent(nudge.id)}`;
  const actions: PushNotificationPayload["actions"] = nudge.targetId
    ? [{ action: "get_directions", title: "دلّني" }, { action: "show_on_map", title: "على الخريطة" }]
    : nudge.kind === "visit_ending" && /محطات باقية/.test(nudge.text)
      ? [{ action: "shorten_plan", title: "قصّر الجولة" }]
      : [];
  return {
    v: 1,
    id: nudge.id,
    kind: nudge.kind,
    title: TITLES[nudge.kind],
    body: nudge.text.slice(0, 240),
    url,
    ...(nudge.targetId ? { targetId: nudge.targetId } : {}),
    actions,
  };
}

/** Urgency hint for the push service: a show about to start may wake a sleeping phone. */
export function nudgeUrgency(nudge: Nudge) {
  return nudge.kind === "visit_ending" ? "normal" as const : "high" as const;
}
