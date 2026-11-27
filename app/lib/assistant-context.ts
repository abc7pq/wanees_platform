export const ASSISTANT_CONTEXT_TTL_MS = 24 * 60 * 60 * 1000;

export type PendingStopChange = {
  itineraryId: string;
  intent: "remove" | "swap";
  moodHint?: string;
  preferenceHint?: "quiet" | "cheap" | "near";
};

export type AssistantContext = {
  version: 1;
  lastSearchIds: string[];
  lastLocationIds: string[];
  lastSuggestedActivityId?: string;
  pendingStopChange?: PendingStopChange;
  /** «انا عند جناح افريقيا»: the zone the visitor said they are in, trusted for 20 minutes (audit 3.1). */
  spokenPosition?: { zone: string; at: string };
  updatedAt: string;
};

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
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : expiresAt.toISOString(),
  };
}

export function mergeAssistantContext(
  current: AssistantContext | null,
  patch: Partial<Pick<AssistantContext, "lastSearchIds" | "lastLocationIds" | "lastSuggestedActivityId">>
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
