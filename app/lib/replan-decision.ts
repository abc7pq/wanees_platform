// Client side of "accept / keep my plan" on a replan proposal (MOB-1).
// Kept free of React and Next imports so node can test it directly (lib/replan-decision-test.mjs).

export type ReplanDecision = "accept" | "keep_current";

export type ReplanProposalRef = {
  id: string;
  baseItineraryId?: string;
  baseLiveRevision?: string;
};

/** Same shape as a React ref: `useRef(false)` passes straight in. */
export type InFlightFlag = { current: boolean };

/** Like the page's durableRequest: resolves with the JSON body, throws an Error with `code` on non-2xx. */
export type ReplanRequest = (path: string, options?: { method?: string; body?: string }) => Promise<any>;

export type ServerPlan<I> = { itineraryId: string; itinerary: I };

export type ReplanOutcome<I> =
  | { kind: "busy" }
  | { kind: "applied"; plan: ServerPlan<I>; nowMinute: number | null }
  | { kind: "kept"; nowMinute: number | null }
  /** The proposal was refused as stale; `serverPlan` is what the server holds now, or null if that reload failed too. */
  | { kind: "stale"; serverPlan: ServerPlan<I> | null }
  | { kind: "failed"; error: unknown };

export const STALE_PROPOSAL_CODES = new Set(["PROPOSAL_STALE", "PROPOSAL_NOT_FOUND"]);
export const STALE_PROPOSAL_MESSAGE = "ما عاد الاقتراح متاحًا. مسارك الحالي محفوظ.";

/**
 * Sends one replan decision. `inFlight` is checked and set before the first await, so a second tap in the
 * same frame (when React state such as `replanBusy` has not re-rendered yet) returns "busy" and sends nothing.
 * On a stale refusal it reloads the itinerary, so the screen can show the server's plan rather than its own guess.
 */
export async function sendReplanDecision<I>(
  inFlight: InFlightFlag,
  request: ReplanRequest,
  eventSlug: string,
  proposal: ReplanProposalRef,
  decision: ReplanDecision,
): Promise<ReplanOutcome<I>> {
  if (inFlight.current) return { kind: "busy" };
  inFlight.current = true;
  const base = `/api/v1/events/${encodeURIComponent(eventSlug)}/itinerary`;
  try {
    const response = await request(`${base}/replan`, {
      method: "POST",
      body: JSON.stringify({
        decision,
        proposalId: proposal.id,
        baseItineraryId: proposal.baseItineraryId,
        baseLiveRevision: proposal.baseLiveRevision,
        reason: decision === "accept" ? "visitor_accepted" : "visitor_kept_current",
      }),
    });
    const nowMinute = typeof response?.data?.clock?.nowMinute === "number" ? response.data.clock.nowMinute : null;
    if (decision === "accept" && response?.data?.itinerary) {
      return { kind: "applied", plan: { itineraryId: response.data.itineraryId, itinerary: response.data.itinerary }, nowMinute };
    }
    return { kind: "kept", nowMinute };
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (!code || !STALE_PROPOSAL_CODES.has(code)) return { kind: "failed", error };
    // The proposal may already be applied elsewhere (another tab, a retry): ask the server what the plan is now.
    let serverPlan: ServerPlan<I> | null = null;
    try {
      const plan = await request(base);
      if (plan?.data?.itinerary) serverPlan = { itineraryId: plan.data.itineraryId, itinerary: plan.data.itinerary };
    } catch { /* keep what is on screen; the next live refresh reconciles it */ }
    return { kind: "stale", serverPlan };
  } finally {
    inFlight.current = false;
  }
}

/** The itinerary fields of screen state after an outcome: the server's plan wins whenever we have it. */
export function applyReplanOutcome<S extends { itineraryId?: string; itinerary: I | null }, I>(state: S, outcome: ReplanOutcome<I>): S {
  if (outcome.kind === "applied") return { ...state, itineraryId: outcome.plan.itineraryId, itinerary: outcome.plan.itinerary };
  if (outcome.kind === "stale" && outcome.serverPlan) {
    return { ...state, itineraryId: outcome.serverPlan.itineraryId, itinerary: outcome.serverPlan.itinerary };
  }
  return state;
}
