// Domain types for the deterministic incentive selector (aligned with the team contract).
// These are pure data shapes: the selector never touches Prisma, the network or an LLM.

export type IncentiveKind = "FREE_ITEM" | "DISCOUNT" | "PRIORITY_ENTRY" | "FREE_ACTIVITY" | "CREDIT";
/** Subset of EventUpdateType; crowd_spike maps to CROWD_OVERRIDE at the engine boundary. */
export type IncentiveTrigger = "CLOSURE" | "DELAY" | "SCHEDULE_CHANGE" | "CROWD_OVERRIDE";
export type IncentiveScopeTarget = "EVENT" | "ZONE" | "ACTIVITY";

/** An incentive flattened for selection. `scopeKey` is a stableKey (no FK). */
export interface IncentiveDomain {
  id: string;
  kind: IncentiveKind;
  titleAr: string;
  valueLabelAr: string;
  reasonAr: string;
  valueCents: number;
  priority: number;
  trigger: IncentiveTrigger | null;
  scopeTarget: IncentiveScopeTarget | null;
  scopeKey: string | null;
  minCrowdLevel: number | null;
  redirectZoneKey: string | null;
  endsAt: Date | null;
  locationLabelAr: string | null;
  perVisitorCap: number;
  claimsCount: number;
}

export interface IncentiveSelectionContext {
  /** Active event-update types (normalized) that triggered this replan. */
  triggers: ReadonlySet<IncentiveTrigger>;
  /** stableKey of the currently most-crowded zone, or null when unknown. */
  zoneStableKey: string | null;
  /** Crowd level of that zone, clamped to 0..1. */
  crowdLevel: number;
  /** Estimated visitor wait in minutes (0 when unknown). */
  waitMinutes: number;
  /** Incentive ids this visitor session has already claimed (never re-offer). */
  alreadyClaimedIds: ReadonlySet<string>;
}

/**
 * Serializable shape handed to the visitor client and the replan alert — the FINAL team
 * contract (5 kinds + Arabic-suffixed fields). Frontend Developer and AI Engineer both
 * consume exactly these fields; do not add legacy fields (code/title/zoneStableKey/redirectZoneKey).
 */
export interface IncentiveDisplay {
  incentiveId: string;
  kind: IncentiveKind;
  titleAr: string;
  valueLabelAr: string;
  reasonAr: string;
  valueCents: number;
  expiresAt: string | null;
  locationLabelAr: string | null;
}
