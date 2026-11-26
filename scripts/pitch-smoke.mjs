import assert from "node:assert/strict";
import { PITCH_EVENT_SLUG } from "../packages/contracts/src/index.ts";

const visitor = process.env.WANEES_BASE_URL ?? "http://127.0.0.1:3100";
const admin = process.env.WANEES_ADMIN_BASE_URL ?? "http://127.0.0.1:3200";
const password = process.env.WANEES_PITCH_OPERATOR_PASSWORD;
assert.ok(password, "WANEES_PITCH_OPERATOR_PASSWORD is required for the rehearsal smoke test");

function createClient(origin) {
  const cookies = new Map();
  return async (path, method = "GET", input, expected = 200, idempotencyKey) => {
    const headers = { cookie: [...cookies.values()].join("; "), origin };
    if (input !== undefined) headers["content-type"] = "application/json";
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
    const response = await fetch(origin + path, { method, headers, body: input === undefined ? undefined : JSON.stringify(input) });
    const body = await response.json().catch(() => null);
    for (const set of response.headers.getSetCookie()) {
      const pair = set.split(";")[0];
      cookies.set(pair.split("=")[0], pair);
    }
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(body?.error ?? "")}`);
    return { data: body?.data, body, response };
  };
}

const base = `/api/v1/events/${PITCH_EVENT_SLUG}`;
const operator = createClient(admin);
await operator("/api/login", "POST", { email: "operator@pitch.wanees.demo", password });
const events = await operator("/api/v1/events");
assert.deepEqual(events.data.events.map(({ slug }) => slug), [PITCH_EVENT_SLUG]);
await operator("/api/v1/events/boulevard-world-demo/updates", "POST", {
  updateType: "DELAY", targetType: "activity", targetId: "giraffe", payload: { minutes: 25 },
}, 404);
assert.equal((await operator(`${base}/updates?view=active`)).data.length, 0, "Use an idle rehearsal event");

const results = [];
for (const outcome of ["keep_current", "accept", "closure"]) {
  const guest = createClient(visitor);
  let updateId;
  try {
    const session = await guest(`${base}/session`, "POST", {
      clientType: "web", locale: "ar-SA", entryPoint: "pitch_qr",
      preferences: { companions: "عائلة وأطفال", mood: "هادئ", interests: ["طعام", "عائلة"], availableMinutes: 120, budgetMaxCents: 30000, startPointId: "main-entrance", optInPersist: true },
    }, 201);
    assert.equal(session.data.personalized, false);
    assert.equal(session.data.clock.source, "demo_clock");
    assert.equal(session.data.clock.nowMinute, 1080);
    assert.ok(!session.response.headers.getSetCookie().some((value) => value.startsWith("wanees_guest")));
    const made = (await guest(`${base}/itinerary`, "POST", { generatedReason: "pitch_smoke" }, 201)).data;
    const initial = made.itinerary;
    const target = initial.stops.find((stop) => stop.start > 1080);
    assert.ok(target, "The family rehearsal needs a future stop");
    const location = await guest(`${base}/assistant`, "POST", { message: "وين دورة المياه؟" });
    assert.equal(location.data.intent, "location");
    assert.ok(location.data.sources.some((source) => source.id === "service-restrooms-main"));

    const endsAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const draft = {
      updateType: outcome === "closure" ? "CLOSURE" : "DELAY",
      targetType: "activity", targetId: target.act_id, startsAt: new Date().toISOString(), endsAt,
      payload: { reason: "تحديث في العرض التجريبي", ...(outcome !== "closure" ? { minutes: 25 } : {}) },
    };
    const key = crypto.randomUUID();
    const update = await operator(`${base}/updates`, "POST", draft, 201, key);
    updateId = update.data.update.id;
    assert.equal((await operator(`${base}/updates`, "POST", draft, 201, key)).data.update.id, updateId);
    const live = (await guest(`${base}/live`)).data;
    assert.ok(live.updates.some((entry) => entry.id === updateId));
    const preview = (await guest(`${base}/itinerary/replan`, "POST", {
      decision: "preview", baseItineraryId: made.itineraryId, baseLiveRevision: live.revision,
    })).data;
    assert.equal(preview.live.liveRevision, live.revision);

    if (outcome === "closure") {
      assert.equal(preview.mode, "APPLIED");
      assert.ok(!preview.itinerary.stops.some((stop) => stop.act_id === target.act_id));
    } else {
      assert.equal(preview.mode, "PROPOSED");
      assert.ok(preview.diff.moved.some((stop) => stop.id === target.act_id) || preview.diff.removed.some((stop) => stop.id === target.act_id));
      assert.equal((await guest(`${base}/itinerary`)).data.itineraryId, made.itineraryId);
      const decided = (await guest(`${base}/itinerary/replan`, "POST", {
        decision: outcome, proposalId: preview.proposalId,
        baseItineraryId: preview.proposal.baseItineraryId, baseLiveRevision: preview.proposal.baseLiveRevision,
      })).data;
      assert.equal(decided.mode, outcome === "accept" ? "APPLIED" : "DISMISSED");
      const restored = (await guest(`${base}/itinerary`)).data;
      assert.equal(restored.itineraryId, outcome === "accept" ? preview.proposalId : made.itineraryId);
      assert.equal((await guest(`${base}/itinerary/replan`, "POST", { decision: "preview" })).data.mode, "NO_CHANGE");
      assert.ok(restored.itinerary.total_cost <= 300);
      assert.ok(restored.itinerary.stops.every(({ end }) => end <= 1200));
    }
    results.push({ outcome, target: target.name, mode: preview.mode });
  } finally {
    if (updateId) await operator(`${base}/updates/${updateId}`, "PATCH", { action: "revoke", reason: "إعادة ضبط البروفة الآلية" });
    await guest(`${base}/session`, "DELETE").catch(() => {});
  }
}
const customer = createClient(visitor);
const expiration = new Date(Date.now() + 5 * 60_000).toISOString();
const measurement = (await operator(`${base}/updates`, "POST", {
  updateType: "CROWD_OVERRIDE", targetType: "zone", targetId: "africa",
  startsAt: new Date().toISOString(), endsAt: expiration,
  payload: { measurement: "counted", occupiedPeople: 82, waitMinutes: 13 },
}, 201)).data.update;
let offerId;
try {
  const visible = (await customer(`${base}/live`)).data.crowd.find((item) => item.zone === "africa");
  assert.equal(visible.level, 0.82);
  assert.equal(visible.observation.waitMinutes, 13);
  assert.equal(visible.observation.measurement, "counted");

  const offer = (await operator(`${base}/incentives`, "POST", {
    kind: "FREE_ITEM", titleAr: "حافز الاختبار", valueLabelAr: "هدية واحدة",
    reasonAr: "اختبار مسار الاستفادة", valueCents: 0, locationLabelAr: "خدمة الزوار في اختبار العرض",
    endsAt: expiration,
  }, 201)).data;
  offerId = offer.id;
  await customer(`${base}/session`, "POST", { clientType: "web", locale: "ar-SA", entryPoint: "test:offer" }, 201);
  const crowdAnswer = (await customer(`${base}/assistant`, "POST", { message: "كيف الزحمة؟" })).data;
  assert.equal(crowdAnswer.intent, "crowd");
  assert.ok(crowdAnswer.sources.some((source) => source.zone === "africa" && source.level === 0.82 && source.source === "operator"));
  const incentives = (await customer(`${base}/incentives`)).data;
  assert.equal(incentives.find((item) => item.incentive.incentiveId === offerId)?.claimed, false);
  assert.equal((await customer(`${base}/incentives`, "POST", { incentiveId: offerId })).data.claimed, true);
  assert.equal((await customer(`${base}/incentives`, "POST", { incentiveId: offerId })).data.claimed, true);
  assert.equal((await operator(`${base}/incentives`)).data.find((row) => row.id === offerId)?.claimsCount, 1);
} finally {
  if (offerId) await operator(`${base}/incentives/${offerId}`, "PATCH", { endsAt: new Date().toISOString() });
  await operator(`${base}/updates/${measurement.id}`, "PATCH", { action: "revoke", reason: "انتهاء اختبار القياس" });
  await customer(`${base}/session`, "DELETE").catch(() => {});
}
assert.ok(!(await customer(`${base}/live`)).data.crowd.some((item) => item.zone === "africa"));
console.log(JSON.stringify({ rehearsals: results, measurements: "passed", offerClaim: "idempotent", scope: "isolated", persistence: "anonymous" }, null, 2));
