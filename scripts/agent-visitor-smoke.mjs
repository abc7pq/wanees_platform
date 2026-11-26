// End-to-end check that the assistant works with registered visitors, against a running visitor
// server started with WANEES_FEATURE_VISITOR_REGISTRATION=true WANEES_SMS_PROVIDER=test
// WANEES_TEST_OTP_CODE=<6 digits> (and WANEES_ALLOW_TEST_SMS=true for a production build).
//   1. group details told in chat («عيالي أعمارهم 5 و 9») are saved to the visitor for next time;
//   2. an assistant proposal the visitor accepts joins the visitor's activity history;
//   3. identity guardrails hold for a registered visitor too (no name, phone or provider in replies).
// Uses a fake, per-run phone number and deletes the visitor at the end.
//
// Usage: WANEES_TEST_OTP_CODE=246810 node --experimental-strip-types scripts/agent-visitor-smoke.mjs [baseUrl] [eventSlug]
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const origin = (process.argv[2] ?? process.env.WANEES_VISITOR_REG_BASE_URL ?? "http://127.0.0.1:3102").replace(/\/$/, "");
const slug = process.argv[3] ?? "boulevard-world-demo";
const code = process.env.WANEES_TEST_OTP_CODE ?? "";
assert.match(code, /^\d{6}$/, "set WANEES_TEST_OTP_CODE to the code the test server accepts");
const base = `/api/v1/events/${slug}`;

// The database check reads the same database the server uses.
if (!process.env.DATABASE_URL) {
  for (const file of ["app/.env.local", ".env"]) {
    try {
      const line = readFileSync(new URL(`../${file}`, import.meta.url), "utf8").split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
      if (line) { process.env.DATABASE_URL = line.slice("DATABASE_URL=".length).replace(/^"|"$/g, ""); break; }
    } catch { /* try the next file */ }
  }
}
const { prisma } = await import("../app/lib/db.ts");

function createClient() {
  const cookies = new Map();
  return async function call(path, method = "GET", input, expected) {
    const headers = new Headers({ origin });
    if (input !== undefined) headers.set("content-type", "application/json");
    if (cookies.size) headers.set("cookie", [...cookies.values()].join("; "));
    const response = await fetch(origin + path, { method, headers, body: input === undefined ? undefined : JSON.stringify(input) });
    const body = await response.json().catch(() => null);
    for (const set of response.headers.getSetCookie()) {
      const pair = set.split(";")[0];
      if (/Max-Age=0/i.test(set)) cookies.delete(pair.split("=")[0]); else cookies.set(pair.split("=")[0], pair);
    }
    if (expected) assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(body?.error ?? body)}`);
    return { status: response.status, data: body?.data, body };
  };
}

const localPhone = `05${String(Date.now()).slice(-8)}`;
const name = "زائر اختبار الوكيل";
const { VISITOR_CONSENT_VERSION } = await import("../packages/contracts/src/index.ts");
const call = createClient();
let visitorId = null;

try {
  const me0 = await call(`${base}/visitor/me`, "GET", undefined, 200);
  assert.equal(me0.data.registrationRequired, true, "server must run with WANEES_FEATURE_VISITOR_REGISTRATION=true");
  const start = await call(`${base}/visitor/otp/start`, "POST", { name, phone: localPhone, consent: true, consentVersion: VISITOR_CONSENT_VERSION }, 201);
  await call(`${base}/visitor/otp/verify`, "POST", { challengeId: start.data.challengeId, code }, 201);
  visitorId = (await prisma.visitor.findFirst({ where: { phoneE164: `+966${localPhone.slice(1)}` }, select: { id: true } }))?.id ?? null;
  assert.ok(visitorId, "the verified visitor exists");

  await call(`${base}/session`, "POST", { clientType: "web", preferences: { companions: "family", partySize: 2, mood: "هادئ", interests: ["طبيعة", "عروض"], availableMinutes: 180 } }, 201);
  await call(`${base}/itinerary`, "POST", {}, 201);

  // 1. Group details said in chat are remembered on the visitor.
  const told = await call(`${base}/assistant`, "POST", { message: "عيالي أعمارهم 5 و 9" }, 200);
  assert.equal(told.data.intent, "profile");
  const me1 = await call(`${base}/visitor/me`, "GET", undefined, 200);
  assert.equal(me1.data.preferences?.youngestChildAge, 5, "the youngest child's age is saved for next visit");
  assert.ok(me1.data.preferences?.partySize >= 3, "the group size is saved for next visit");
  // The profile change may come back as a proposal; settle it so the next step starts from an active plan.
  if (told.data.proposal) {
    const p = told.data.proposal;
    await call(`${base}/itinerary/replan`, "POST", { decision: "keep_current", proposalId: p.id, baseItineraryId: p.baseItineraryId, baseLiveRevision: p.baseLiveRevision, reason: "visitor_declined" }, 200);
  }

  // 2. Alternatives → tap swap → accept: the new activity joins the visitor's history.
  const alternatives = await call(`${base}/assistant`, "POST", { message: "وش البدائل للمحطة الجاية؟" }, 200);
  assert.equal(alternatives.data.intent, "alternatives");
  assert.equal(alternatives.data.proposal ?? null, null, "listing alternatives proposes nothing");
  const ui = alternatives.data.ui;
  const swap = ui?.[1]?.updateComponents?.components.find((c) => c.id.endsWith("_swap"));
  assert.ok(swap, "alternatives come with a swap button");
  const dm = ui[0].createSurface.dataModel;
  const index = Number(swap.id.match(/^act(\d+)_/)[1]);
  const replacement = dm.items[index].id;
  const target = dm.items[index].swapFor;
  const action = { version: "1.0", action: { name: "swap_with", surfaceId: ui[0].createSurface.surfaceId, sourceComponentId: swap.id, timestamp: new Date().toISOString(), context: { activityId: replacement, targetId: target } } };
  const proposed = await call(`${base}/assistant`, "POST", { action }, 200);
  const proposal = proposed.data.proposal;
  assert.ok(proposal, `tapping an alternative proposes the swap (reply: ${proposed.data.message})`);
  assert.ok(proposal.diff.added.some((item) => item.id === replacement), "the proposal adds the tapped activity");
  const before = (await prisma.visitor.findUnique({ where: { id: visitorId }, select: { visitedKeys: true } })).visitedKeys;
  assert.ok(!before.includes(replacement), "not in the history before the visitor accepts");
  await call(`${base}/itinerary/replan`, "POST", { decision: "accept", proposalId: proposal.id, baseItineraryId: proposal.baseItineraryId, baseLiveRevision: proposal.baseLiveRevision, reason: "visitor_accepted" }, 200);
  const after = (await prisma.visitor.findUnique({ where: { id: visitorId }, select: { visitedKeys: true } })).visitedKeys;
  assert.ok(after.includes(replacement), "an accepted assistant proposal joins the visitor's history");

  // 3. Guardrails for a registered visitor: identity answer, and no name or phone in any reply.
  for (const message of ["انت شات جي بي تي؟", "وش اسمي ورقم جوالي؟", "which model are you?"]) {
    const reply = (await call(`${base}/assistant`, "POST", { message }, 200)).data.message;
    assert.doesNotMatch(reply, /chat ?gpt|openai|\bgpt\b|شات جي بي تي/i, `no provider in: ${reply}`);
    assert.ok(!reply.includes(name) && !reply.includes(localPhone.slice(2)), `no name or phone in: ${reply}`);
  }

  console.log("assistant + registered visitor flow passed: chat details saved, accepted proposal recorded, guardrails hold");
} finally {
  if (visitorId) await call(`${base}/visitor/me`, "DELETE").catch(() => null);
  if (visitorId) await prisma.visitor.deleteMany({ where: { id: visitorId } }).catch(() => null);
  await prisma.$disconnect();
}
