// Runs the presentation's "Abu Fahd" story against a seeded loopback stack:
// a family with a 300 SAR budget gets a plan, the operator delays the dolphin
// show by 25 minutes, WANEES proposes an alternative without changing the
// plan, and the visitor approves it. Every claim is checked, not narrated.
const baseUrl = process.env.WANEES_BASE_URL ?? "http://127.0.0.1:3100";
const adminUrl = process.env.WANEES_ADMIN_BASE_URL ?? "http://127.0.0.1:3200";
const adminToken = process.env.ADMIN_TOKEN ?? "";
const eventSlug = "boulevard-world-demo";
const budgetSar = 300;
let cookie = "";

async function visitor(path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} returned ${response.status}: ${JSON.stringify(body)}`);
  return body.data;
}

async function operator(path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  headers.set("origin", adminUrl);
  if (adminToken) headers.set("x-admin-token", adminToken);
  const response = await fetch(`${adminUrl}${path}`, { ...init, headers });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`admin ${init.method ?? "GET"} ${path} returned ${response.status}: ${JSON.stringify(body)}`);
  return body.data;
}

function check(condition, message) {
  if (!condition) throw new Error(`deck story failed: ${message}`);
  console.log(`✓ ${message}`);
}

const names = (itinerary) => itinerary.stops.map((stop) => stop.name).join(" → ");

// 1. The four questions: who is with you, budget, time, interests.
await visitor(`/api/v1/events/${eventSlug}/session`, {
  method: "POST",
  body: JSON.stringify({
    clientType: "web", locale: "ar-SA", entryPoint: "deck-story",
    preferences: { companions: "عائلة وأطفال", interests: ["عائلة", "طبيعة", "عروض"], budgetMaxCents: budgetSar * 100, availableMinutes: 180, startPointId: "main-entrance" },
  }),
});
const created = await visitor(`/api/v1/events/${eventSlug}/itinerary`, { method: "POST", body: JSON.stringify({ generatedReason: "deck-story" }) });
const plan = created.itinerary;
console.log(`plan: ${names(plan)} (${plan.total_cost} SAR)`);
check(plan.stops.length >= 2, "a family plan is built from the four answers");
check(plan.total_cost <= budgetSar, `the plan stays within the ${budgetSar} SAR budget (${plan.total_cost} SAR)`);
check(plan.explanations.length > 0, "the plan explains why each step was chosen");
check(new Set(plan.stops.map((stop) => stop.zone)).size >= 2, "the plan spreads across more than one zone");

// 2. Abu Fahd asks for the dolphin show by name. WANEES proposes; the family accepts.
let activePlan = plan;
let activeItineraryId = created.itineraryId;
if (!plan.stops.some((stop) => stop.act_id === "dolphinarium")) {
  const ask = await visitor(`/api/v1/events/${eventSlug}/assistant`, { method: "POST", body: JSON.stringify({ message: "أبي عرض الدولفيناريوم" }) });
  check(Boolean(ask.proposal?.id), `asking for the dolphin show by name gives a proposal: "${ask.message.slice(0, 120)}…"`);
  const added = await visitor(`/api/v1/events/${eventSlug}/itinerary/replan`, {
    method: "POST",
    body: JSON.stringify({ decision: "accept", proposalId: ask.proposal.id, baseItineraryId: ask.proposal.baseItineraryId, baseLiveRevision: ask.proposal.baseLiveRevision }),
  });
  check(added.mode === "APPLIED", "the family accepts and the dolphin show joins the plan");
  const current = await visitor(`/api/v1/events/${eventSlug}/itinerary`);
  activePlan = current.itinerary;
  activeItineraryId = current.itineraryId;
  console.log(`plan with dolphins: ${names(activePlan)} (${activePlan.total_cost} SAR)`);
}
check(activePlan.total_cost <= budgetSar, `the plan with the dolphin show stays within ${budgetSar} SAR (${activePlan.total_cost} SAR)`);

// 3. The operator delays the dolphin show by 25 minutes, as in the deck.
const live = await visitor(`/api/v1/events/${eventSlug}/live`);
const nowMinute = live.clock?.minute ?? live.clock?.nowMinute ?? 0;
const delayed = activePlan.stops.find((stop) => stop.act_id === "dolphinarium" && stop.start > nowMinute);
check(Boolean(delayed), "the dolphin show is an upcoming stop in the family's plan");
const reason = `تأخر ${delayed.name} ٢٥ دقيقة`;
const update = await operator(`/api/v1/events/${eventSlug}/updates`, {
  method: "POST",
  headers: { "idempotency-key": `deck-story-${Date.now()}` },
  body: JSON.stringify({
    updateType: "DELAY", targetType: "activity", targetId: delayed.act_id,
    startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    payload: { minutes: 25, reason },
  }),
});
check(Boolean(update?.update?.id), `the operator published "${reason}"`);

try {
  // 4. WANEES proposes; the active plan does not change without consent.
  const liveAfter = await visitor(`/api/v1/events/${eventSlug}/live`);
  check(liveAfter.updates.some((item) => item.id === update.update.id), "visitors see the operator update in live state");
  const preview = await visitor(`/api/v1/events/${eventSlug}/itinerary/replan`, {
    method: "POST",
    body: JSON.stringify({ decision: "preview", baseItineraryId: activeItineraryId, baseLiveRevision: liveAfter.revision }),
  });
  const unchanged = await visitor(`/api/v1/events/${eventSlug}/itinerary`);
  check(unchanged.itineraryId === activeItineraryId, "the active plan is unchanged until the visitor decides");

  check(preview.mode === "PROPOSED", `a 25-minute delay to a planned show produces a proposal (mode ${preview.mode})`);
  {
    const timeline = (itinerary) => itinerary.stops.map((stop) => `${stop.act_id}@${stop.start}`).join(",");
    console.log(`proposal: ${names(preview.candidateItinerary)} (${preview.candidateItinerary.total_cost} SAR)`);
    check(timeline(preview.candidateItinerary) !== timeline(activePlan), "the proposal visibly differs from the current plan (stops or times)");
    const dolphins = preview.candidateItinerary.stops.find((stop) => stop.act_id === "dolphinarium");
    check(!dolphins || dolphins.start >= delayed.start + 25, "the proposal respects the new dolphin show time");
    check(preview.candidateItinerary.total_cost <= budgetSar, "the alternative also stays within budget");
    const accepted = await visitor(`/api/v1/events/${eventSlug}/itinerary/replan`, {
      method: "POST",
      body: JSON.stringify({ decision: "accept", proposalId: preview.proposalId, baseItineraryId: preview.proposal.baseItineraryId, baseLiveRevision: preview.proposal.baseLiveRevision }),
    });
    check(accepted.mode === "APPLIED", "the visitor approves and the new route is saved");
  }

  // 5. The assistant explains in Arabic, grounded in the event data.
  const answer = await visitor(`/api/v1/events/${eventSlug}/assistant`, { method: "POST", body: JSON.stringify({ message: "ليش اخترت لي هذا المسار؟" }) });
  check(typeof answer.message === "string" && answer.message.length > 0, `the assistant explains the route: "${answer.message.slice(0, 140)}…"`);
} finally {
  await operator(`/api/v1/events/${eventSlug}/updates/${update.update.id}`, { method: "PATCH", body: JSON.stringify({ action: "revoke", reason: "انتهاء اختبار القصة" }) });
}
console.log("deck story passed");
