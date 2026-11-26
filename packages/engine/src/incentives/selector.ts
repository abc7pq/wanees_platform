import type { IncentiveDisplay, IncentiveDomain, IncentiveSelectionContext } from "./types";

// Deterministic allocation weights. The engine balances two interests:
//   siteTerm    — the venue wants the crowded zone relieved at the least cost (site interest)
//   visitorTerm — the visitor wants the disruption compensated (visitor comfort)
// Both terms are in [0,1]; the total score is in [0,1]. The function is pure: no Math.random,
// no clock reads, no LLM. Same inputs → same output.
const W_SITE = 0.6;
const W_VISITOR = 0.4;
// An event-wide incentive (no zone match) still gets a small site-interest baseline so a
// zone-specific offer wins when that zone is crowded, but a general offer can still be shown.
const GENERAL_SITE_BASELINE = 0.25;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Cost of each kind to the site (1 = cheapest). Defaults to be tuned from real margin data in
 * `valueCents`/`valueLabelAr` once available.
 */
function affordability(kind: IncentiveDomain["kind"]): number {
  switch (kind) {
    case "PRIORITY_ENTRY":
      return 1.0; // reordering only, ~zero direct cost
    case "DISCOUNT":
      return 0.9; // keeps a sale, loses margin
    case "CREDIT":
      return 0.9; // deferred spend
    case "FREE_ITEM":
      return 0.85; // cost of goods + return incentive
    case "FREE_ACTIVITY":
      return 0.8; // full admission revenue waived
    default:
      return 1.0;
  }
}

/** How much this incentive relieves *this* visitor, by kind and current discomfort. */
function visitorRelief(
  kind: IncentiveDomain["kind"],
  crowdLevel: number,
  waitMinutes: number,
): number {
  switch (kind) {
    case "PRIORITY_ENTRY":
      // A priority pass cuts waiting, and only matters when there is actually a queue.
      return clamp01(0.3 + 0.7 * clamp01(waitMinutes / 30));
    case "FREE_ITEM":
    case "FREE_ACTIVITY":
      return clamp01(0.6 + 0.4 * crowdLevel);
    case "DISCOUNT":
    case "CREDIT":
      return clamp01(0.5 + 0.3 * crowdLevel);
    default:
      return 0.5;
  }
}

/** Site interest = relief of the crowded zone, multiplied by the cost of the incentive. */
function siteTerm(incentive: IncentiveDomain, ctx: IncentiveSelectionContext): number {
  const relief =
    incentive.scopeTarget === "ZONE" && incentive.scopeKey === ctx.zoneStableKey
      ? clamp01(ctx.crowdLevel)
      : GENERAL_SITE_BASELINE;
  return relief * affordability(incentive.kind);
}

/** Eligibility gates; all must hold for the incentive to be offered. */
export function isEligible(incentive: IncentiveDomain, ctx: IncentiveSelectionContext): boolean {
  if (incentive.trigger !== null && !ctx.triggers.has(incentive.trigger)) return false;
  if (ctx.alreadyClaimedIds.has(incentive.id)) return false;
  if (incentive.claimsCount >= incentive.perVisitorCap) return false;
  if (incentive.minCrowdLevel !== null && ctx.crowdLevel < incentive.minCrowdLevel) return false;
  return true;
}

function score(incentive: IncentiveDomain, ctx: IncentiveSelectionContext): number {
  const site = siteTerm(incentive, ctx);
  const visitor = visitorRelief(incentive.kind, ctx.crowdLevel, ctx.waitMinutes);
  return W_SITE * site + W_VISITOR * visitor;
}

/**
 * Deterministically select one incentive to show in the replan alert, or null.
 *
 * Ordering is total and stable: score (desc), then operator `priority` (desc), then `id` (asc).
 * Nothing here is random and nothing depends on an LLM; the caller supplies all inputs.
 */
export function selectIncentive(
  incentives: readonly IncentiveDomain[],
  ctx: IncentiveSelectionContext,
): IncentiveDomain | null {
  const scored: { incentive: IncentiveDomain; score: number }[] = [];
  for (const incentive of incentives) {
    if (!isEligible(incentive, ctx)) continue;
    scored.push({ incentive, score: score(incentive, ctx) });
  }
  if (scored.length === 0) return null;
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.incentive.priority - a.incentive.priority ||
      (a.incentive.id < b.incentive.id ? -1 : a.incentive.id > b.incentive.id ? 1 : 0),
  );
  return scored[0].incentive;
}

/** Render the incentive for the visitor client (Arabic-first, final team contract shape). */
export function toIncentiveDisplay(incentive: IncentiveDomain): IncentiveDisplay {
  return {
    incentiveId: incentive.id,
    kind: incentive.kind,
    titleAr: incentive.titleAr,
    valueLabelAr: incentive.valueLabelAr,
    reasonAr: incentive.reasonAr,
    valueCents: incentive.valueCents,
    expiresAt: incentive.endsAt?.toISOString() ?? null,
    locationLabelAr: incentive.locationLabelAr,
  };
}
