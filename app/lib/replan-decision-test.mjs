// MOB-1: the visitor's accept/keep decision on a replan proposal.
import assert from "node:assert/strict";
import { applyReplanOutcome, sendReplanDecision, STALE_PROPOSAL_MESSAGE } from "./replan-decision.ts";

const proposal = { id: "prop-1", baseItineraryId: "it-1", baseLiveRevision: "rev-1" };
const stalePlan = { stops: [{ id: "giraffes" }, { id: "meerkats" }], unfulfilled: [], explanations: [], total_cost: 45 };
const candidate = { stops: [{ id: "giraffes" }], unfulfilled: [], explanations: [], total_cost: 30 };
const serverPlan = { stops: [{ id: "giraffes" }, { id: "restaurant" }], unfulfilled: [], explanations: [], total_cost: 100 };

/** A fake server. `replan` decides what POST .../replan does; GET .../itinerary returns `itinerary`. */
function fakeServer({ replan, itinerary = { itineraryId: "it-2", itinerary: serverPlan } }) {
  const calls = [];
  const request = async (path, options = {}) => {
    calls.push({ path, method: options.method ?? "GET", body: options.body ? JSON.parse(options.body) : null });
    await new Promise((resolve) => setTimeout(resolve, 5)); // the response arrives in a later frame
    if (path.endsWith("/itinerary/replan")) return replan();
    if (path.endsWith("/itinerary")) {
      if (itinerary instanceof Error) throw itinerary;
      return { data: itinerary };
    }
    throw new Error(`unexpected ${path}`);
  };
  return { calls, request, posts: () => calls.filter((c) => c.method === "POST") };
}
const refused = (code, status) => Object.assign(new Error(code), { code, status });

// 1. Two taps in the same frame send exactly one accept request.
{
  const server = fakeServer({ replan: () => ({ data: { itineraryId: "it-2", itinerary: candidate, clock: { nowMinute: 1170 } } }) });
  const inFlight = { current: false };
  // Both calls start before either awaits, which is what a same-frame double tap does: neither sees a re-render.
  const first = sendReplanDecision(inFlight, server.request, "demo-zoo", proposal, "accept");
  const second = sendReplanDecision(inFlight, server.request, "demo-zoo", proposal, "accept");
  const [a, b] = await Promise.all([first, second]);
  assert.equal(server.posts().length, 1, "same-frame double tap must send 1 accept request");
  assert.equal(a.kind, "applied");
  assert.equal(b.kind, "busy");
  assert.deepEqual(server.posts()[0].body, {
    decision: "accept", proposalId: "prop-1", baseItineraryId: "it-1", baseLiveRevision: "rev-1", reason: "visitor_accepted",
  });
  assert.equal(server.posts()[0].path, "/api/v1/events/demo-zoo/itinerary/replan");
  assert.equal(inFlight.current, false, "guard is released after the request settles");
  assert.deepEqual(applyReplanOutcome({ itineraryId: "it-1", itinerary: stalePlan }, a), { itineraryId: "it-2", itinerary: candidate });
  assert.equal(a.nowMinute, 1170);

  // A later, separate tap is not blocked.
  const third = await sendReplanDecision(inFlight, server.request, "demo-zoo", proposal, "keep_current");
  assert.equal(third.kind, "kept");
  assert.equal(server.posts().length, 2);
  assert.equal(server.posts()[1].body.reason, "visitor_kept_current");
}

// 2. After a stale refusal (404 PROPOSAL_NOT_FOUND or 409 PROPOSAL_STALE), the screen shows the server's itinerary.
for (const [code, status] of [["PROPOSAL_NOT_FOUND", 404], ["PROPOSAL_STALE", 409]]) {
  const server = fakeServer({ replan: () => { throw refused(code, status); } });
  const inFlight = { current: false };
  const screen = { sessionId: "s", itineraryId: "it-1", itinerary: stalePlan, now: 1160 };
  const outcome = await sendReplanDecision(inFlight, server.request, "demo-zoo", proposal, "accept");
  assert.equal(outcome.kind, "stale", code);
  assert.deepEqual(server.calls.map((c) => `${c.method} ${c.path}`), [
    "POST /api/v1/events/demo-zoo/itinerary/replan",
    "GET /api/v1/events/demo-zoo/itinerary",
  ], `${code}: reloads the itinerary after the refusal`);
  const after = applyReplanOutcome(screen, outcome);
  assert.deepEqual(after.itinerary, serverPlan, `${code}: itinerary on screen matches the server's`);
  assert.equal(after.itineraryId, "it-2");
  assert.equal(after.sessionId, "s", "other screen state is kept");
  assert.equal(inFlight.current, false);
}

// 3. If the reload fails as well, the screen keeps what it had (the next live refresh reconciles it).
{
  const server = fakeServer({ replan: () => { throw refused("PROPOSAL_STALE", 409); }, itinerary: new Error("offline") });
  const screen = { itineraryId: "it-1", itinerary: stalePlan };
  const outcome = await sendReplanDecision({ current: false }, server.request, "demo-zoo", proposal, "accept");
  assert.equal(outcome.kind, "stale");
  assert.equal(outcome.serverPlan, null);
  assert.equal(applyReplanOutcome(screen, outcome), screen);
}

// 4. Other errors are failures and do not reload or clear the plan; the guard is still released.
{
  const server = fakeServer({ replan: () => { throw refused("RATE_LIMITED", 429); } });
  const inFlight = { current: false };
  const outcome = await sendReplanDecision(inFlight, server.request, "demo-zoo", proposal, "accept");
  assert.equal(outcome.kind, "failed");
  assert.equal(server.calls.length, 1);
  assert.equal(inFlight.current, false);
}

assert.equal(STALE_PROPOSAL_MESSAGE, "ما عاد الاقتراح متاحًا. مسارك الحالي محفوظ.");
console.log("replan-decision tests passed");
