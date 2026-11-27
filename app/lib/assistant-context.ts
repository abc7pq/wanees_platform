export const ASSISTANT_CONTEXT_TTL_MS = 24 * 60 * 60 * 1000;

export type PendingStopChange = {
  itineraryId: string;
  intent: "remove" | "swap";
  moodHint?: string;
  preferenceHint?: "quiet" | "cheap" | "near";
};

/** «وش رايك في الزرافات؟» answered in a call: an activity key and a 1–5 number, nothing else. */
export type StopFeedback = { activityKey: string; rating: number; atMinute: number };
const MAX_STOP_FEEDBACK = 12;

export type AssistantContext = {
  version: 1;
  lastSearchIds: string[];
  lastLocationIds: string[];
  lastSuggestedActivityId?: string;
  pendingStopChange?: PendingStopChange;
  /** «انا عند جناح افريقيا»: the zone the visitor said they are in, trusted for 20 minutes (audit 3.1). */
  spokenPosition?: { zone: string; at: string };
  /** Ratings the visitor gave stops during this visit (ids and numbers only). */
  stopFeedback: StopFeedback[];
  /** Live calls started in this visit, so a later call resumes instead of greeting from scratch. */
  callCount: number;
  /** Zones picked for this visitor (agent v8), so the opening suggestion and the plan built after it agree. */
  focusZones?: string[];
  updatedAt: string;
};

function readStopFeedback(value: unknown): StopFeedback[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { activityKey, rating, atMinute } = item as Record<string, unknown>;
    if (typeof activityKey !== "string" || activityKey.length > 120 || typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) return [];
    return [{ activityKey, rating, atMinute: typeof atMinute === "number" && Number.isFinite(atMinute) ? atMinute : 0 }];
  }).slice(-MAX_STOP_FEEDBACK);
}

/** One rating per stop: a new answer about the same stop replaces the old one. */
export function withStopFeedback(current: readonly StopFeedback[], feedback: StopFeedback) {
  return [...current.filter((item) => item.activityKey !== feedback.activityKey), feedback].slice(-MAX_STOP_FEEDBACK);
}

function readPendingStopChange(value: unknown): PendingStopChange | undefined {
  if (!value || typeof value !== "object") return;
  const { itineraryId, intent, moodHint, preferenceHint } = value as Record<string, unknown>;
  if (typeof itineraryId !== "string" || (intent !== "remove" && intent !== "swap")) return;
  return {
    itineraryId,
    intent,
    moodHint: typeof moodHint === "string" ? moodHint : undefined,
    preferenceHint: preferenceHint === "quiet" || preferenceHint === "cheap" || preferenceHint === "near" ? preferenceHint : undefined,
  };
}

function readSpokenPosition(value: unknown): AssistantContext["spokenPosition"] {
  if (!value || typeof value !== "object") return;
  const { zone, at } = value as Record<string, unknown>;
  return typeof zone === "string" && zone.length <= 120 && typeof at === "string" && Number.isFinite(Date.parse(at)) ? { zone, at } : undefined;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 8) : [];
}

export function readAssistantContext(value: unknown, expiresAt: Date | null | undefined, now = new Date()): AssistantContext | null {
  if (!expiresAt || expiresAt.getTime() <= now.getTime() || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  return {
    version: 1,
    lastSearchIds: stringArray(raw.lastSearchIds),
    lastLocationIds: stringArray(raw.lastLocationIds),
    lastSuggestedActivityId: typeof raw.lastSuggestedActivityId === "string" ? raw.lastSuggestedActivityId : undefined,
    pendingStopChange: readPendingStopChange(raw.pendingStopChange),
    spokenPosition: readSpokenPosition(raw.spokenPosition),
    stopFeedback: readStopFeedback(raw.stopFeedback),
    callCount: typeof raw.callCount === "number" && Number.isInteger(raw.callCount) && raw.callCount >= 0 ? Math.min(raw.callCount, 1000) : 0,
    focusZones: stringArray(raw.focusZones).filter((zone) => zone.length <= 120).slice(0, 3),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : expiresAt.toISOString(),
  };
}

export function mergeAssistantContext(
  current: AssistantContext | null,
  patch: Partial<Pick<AssistantContext, "lastSearchIds" | "lastLocationIds" | "lastSuggestedActivityId" | "stopFeedback" | "callCount" | "focusZones">>
    & { pendingStopChange?: PendingStopChange | null; spokenPosition?: AssistantContext["spokenPosition"] | null },
  now = new Date(),
) {
  const next: AssistantContext = {
    version: 1,
    lastSearchIds: patch.lastSearchIds ? [...new Set(patch.lastSearchIds)].slice(0, 8) : current?.lastSearchIds ?? [],
    lastLocationIds: patch.lastLocationIds ? [...new Set(patch.lastLocationIds)].slice(0, 8) : current?.lastLocationIds ?? [],
    lastSuggestedActivityId: patch.lastSuggestedActivityId ?? current?.lastSuggestedActivityId,
    pendingStopChange: patch.pendingStopChange === undefined ? current?.pendingStopChange : patch.pendingStopChange ?? undefined,
    spokenPosition: patch.spokenPosition === undefined ? current?.spokenPosition : patch.spokenPosition ?? undefined,
    stopFeedback: patch.stopFeedback ? readStopFeedback(patch.stopFeedback) : current?.stopFeedback ?? [],
    callCount: patch.callCount ?? current?.callCount ?? 0,
    focusZones: patch.focusZones ? [...new Set(patch.focusZones)].slice(0, 3) : current?.focusZones ?? [],
    updatedAt: now.toISOString(),
  };
  return next;
}

export function contextExpiresAt(now = new Date()) {
  return new Date(now.getTime() + ASSISTANT_CONTEXT_TTL_MS);
}

export function contextActivityCandidates(context: AssistantContext | null, availableIds: Set<string>) {
  if (!context) return [];
  const ids = [
    context.lastSuggestedActivityId,
    ...context.lastSearchIds,
  ].filter((id): id is string => Boolean(id));
  return [...new Set(ids)].filter((id) => availableIds.has(id));
}
