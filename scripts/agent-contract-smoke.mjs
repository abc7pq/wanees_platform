// The agent contract across screens (audit 5.1–5.3). One scripted conversation goes through the phone
// (text), a live call (the call channel) and a kiosk, all standing at the same walkway node. Wording may
// differ; the facts (intent, sources, walking minutes, origin) may not. Also checks the kiosk's own rules:
// it registers through the organizer API, counts from its node, keeps no memory, reads a linked phone
// visit read-only, and stops when revoked.
//   WANEES_BASE_URL (visitor), WANEES_ADMIN_BASE_URL and ADMIN_TOKEN (organizer).
import assert from "node:assert/strict";

const baseUrl = process.env.WANEES_BASE_URL ?? "http://127.0.0.1:3100";
const adminUrl = process.env.WANEES_ADMIN_BASE_URL ?? "http://127.0.0.1:3200";
const adminToken = process.env.ADMIN_TOKEN ?? "";
const eventSlug = process.env.WANEES_CONTRACT_EVENT ?? "boulevard-world-demo";
const base = `/api/v1/events/${eventSlug}`;
const { agentFacts } = await import("../packages/contracts/src/agent.ts");

async function json(url, init = {}) {
  const response = await fetch(url, init);
  return { response, body: await response.json().catch(() => null) };
}
async function admin(path, init = {}) {
  const headers = { "content-type": "application/json", origin: adminUrl, ...(adminToken ? { "x-admin-token": adminToken } : {}), ...(init.headers ?? {}) };
  return json(`${adminUrl}${path}`, { ...init, headers });
}

/** A visit as a client sees it: a phone (cookie) or a kiosk (bearer + device token). */
async function startVisit(kind, kioskToken) {
  const headers = { "content-type": "application/json", ...(kioskToken ? { "x-wanees-kiosk-token": kioskToken } : {}) };
  const started = await json(`${baseUrl}${base}/session`, {
    method: "POST", headers,
    body: JSON.stringify({ clientType: kind === "kiosk" ? "kiosk" : "web", locale: "ar-SA", entryPoint: `agent-contract-${kind}`, preferences: kind === "kiosk" ? undefined : { interests: ["طعام"], availableMinutes: 180 } }),
  });
  assert.equal(started.response.status, 201, `${kind} visit: ${JSON.stringify(started.body?.error)}`);
  const cookie = started.response.headers.getSetCookie().find((value) => value.startsWith("wanees_visitor_session="))?.split(";")[0] ?? "";
  const auth = started.body.data.token ? { "x-wanees-session-token": started.body.data.token } : { cookie };
  const call = (path, init = {}) => json(`${baseUrl}${path}`, { ...init, headers: { "content-type": "application/json", ...auth, ...(init.headers ?? {}) } });
  return { data: started.body.data, call };
}

for (let attempt = 0; attempt < 30; attempt += 1) {
  const ok = await fetch(`${baseUrl}/api/health`).then((res) => res.ok).catch(() => false);
  if (ok) break;
  if (attempt === 29) throw new Error("visitor app is not healthy");
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

const event = await json(`${baseUrl}/api/events/${eventSlug}`);
const nodes = event.body?.data?.catalog?.routeGraph?.nodes ?? [];
const kioskNode = nodes.find((node) => node.status === "open" && node.zone === "africa") ?? nodes.find((node) => node.status === "open" && node.zone);
const elsewhere = nodes.find((node) => node.status === "open" && node.zone && node.zone !== kioskNode?.zone);
assert.ok(kioskNode && elsewhere, "the seeded walkway graph needs open nodes in two zones");

// 1. The organizer registers a screen; the token is shown once and a closed or unknown node is refused.
assert.equal((await admin(`/api/v1/events/${eventSlug}/kiosks`, { method: "POST", body: JSON.stringify({ name: "شاشة", nodeKey: "no-such-node" }) })).response.status, 400);
const created = await admin(`/api/v1/events/${eventSlug}/kiosks`, { method: "POST", body: JSON.stringify({ name: "شاشة اختبار العقد", nodeKey: kioskNode.id }) });
assert.equal(created.response.status, 201, JSON.stringify(created.body));
const kioskToken = created.body.data.token;
const kioskId = created.body.data.id;
assert.match(kioskToken, /^wk_/);
const listed = await admin(`/api/v1/events/${eventSlug}/kiosks`);
assert.ok(listed.body.data.some((row) => row.id === kioskId && row.status === "active" && !("token" in row) && !("tokenHash" in row)), "the list never shows a token");
const forged = await json(`${baseUrl}${base}/session`, { method: "POST", headers: { "content-type": "application/json", "x-wanees-kiosk-token": `wk_${"x".repeat(43)}` }, body: JSON.stringify({ clientType: "kiosk" }) });
assert.equal(forged.body?.error?.code, "KIOSK_TOKEN_INVALID");

// 2. Three screens at the same node.
const web = await startVisit("web");
const phoneForCall = await startVisit("web");
const kiosk = await startVisit("kiosk", kioskToken);
assert.equal(kiosk.data.channel, "kiosk");
assert.equal(kiosk.data.authMode, "bearer", "a kiosk never gets a cookie");
assert.equal(kiosk.data.personalized, false);
assert.equal(kiosk.data.remembered, false, "a kiosk visit has no memory");

const here = () => ({ nodeId: kioskNode.id, source: "gps", accuracyM: 10, capturedAt: new Date().toISOString() });
const script = ["وين أقرب دورة مياه؟", "وين أقرب مصلى؟", "وش العروض الجاية؟", "بكم تذكرة الدخول؟", "دلني على جناح آسيا"];
for (const message of script) {
  const viaWeb = await web.call(`${base}/assistant`, { method: "POST", body: JSON.stringify({ message, position: here() }) });
  const viaCall = await phoneForCall.call(`${base}/assistant`, { method: "POST", body: JSON.stringify({ message, channel: "call", position: here() }) });
  // The kiosk sends a different position on purpose: its own node must win.
  const viaKiosk = await kiosk.call(`${base}/assistant`, { method: "POST", body: JSON.stringify({ message, position: { ...here(), nodeId: elsewhere.id } }) });
  for (const [name, reply] of [["web", viaWeb], ["call", viaCall], ["kiosk", viaKiosk]]) {
    assert.equal(reply.response.status, 200, `${name} «${message}»: ${JSON.stringify(reply.body?.error)}`);
    assert.equal(typeof reply.body.data.message, "string");
  }
  assert.ok(viaCall.body.data.facts, "the call channel gets the compact facts its voice may say");
  assert.deepEqual(agentFacts(viaCall.body.data), agentFacts(viaWeb.body.data), `call and web disagree on «${message}»`);
  assert.deepEqual(agentFacts(viaKiosk.body.data), agentFacts(viaWeb.body.data), `kiosk and web disagree on «${message}»`);
  if (viaKiosk.body.data.position) assert.equal(viaKiosk.body.data.position.source, "kiosk");
  console.log(`✓ same facts on web, call and kiosk: «${message}» (${viaWeb.body.data.intent})`);
}

// 3. A picked language on the screen wins over the words.
const english = await kiosk.call(`${base}/assistant`, { method: "POST", body: JSON.stringify({ message: "وين أقرب دورة مياه؟", language: "en" }) });
assert.equal(english.body.data.understanding.language, "en");

// 4. A phone links to the kiosk: the kiosk reads that plan and cannot change it.
const plan = await web.call(`${base}/itinerary`, { method: "POST", body: JSON.stringify({ generatedReason: "agent-contract" }) });
assert.ok(plan.response.ok && plan.body.data.itinerary.stops.length > 0);
const code = (await web.call(`${base}/link`, { method: "POST", body: "{}" })).body.data.code;
const grantId = (await kiosk.call(`${base}/link/redeem`, { method: "POST", body: JSON.stringify({ code }) })).body.data.grantId;
const linkedNext = await kiosk.call(`${base}/assistant`, { method: "POST", body: JSON.stringify({ message: "وش محطتي الجاية؟", linkGrantId: grantId }) });
assert.equal(linkedNext.body?.data?.linked?.scope, "read", JSON.stringify(linkedNext.body));
const phoneNext = await web.call(`${base}/assistant`, { method: "POST", body: JSON.stringify({ message: "وش محطتي الجاية؟" }) });
assert.equal(linkedNext.body.data.next?.activityId, phoneNext.body.data.next?.activityId, "the kiosk must read the phone's own next stop");
const firstStop = plan.body.data.itinerary.stops[0];
const linkedChange = await kiosk.call(`${base}/assistant`, { method: "POST", body: JSON.stringify({ message: `شيل ${firstStop.name}`, linkGrantId: grantId }) });
assert.equal(linkedChange.body.data.linked?.scope, "read");
assert.equal(linkedChange.body.data.itinerary, null);
const after = await web.call(`${base}/itinerary`);
assert.equal(after.body.data.itineraryId, plan.body.data.itineraryId, "a linked kiosk must not change the phone's plan");
await web.call(`${base}/link`, { method: "DELETE" });
const afterRevoke = await kiosk.call(`${base}/assistant`, { method: "POST", body: JSON.stringify({ message: "وش محطتي الجاية؟", linkGrantId: grantId }) });
assert.equal(afterRevoke.response.status, 410, "a revoked link must end the kiosk's access");
console.log("✓ a linked kiosk reads the phone's plan and cannot change it");

// 5. Revoking the screen ends its visit at once and refuses new ones.
assert.equal((await admin(`/api/v1/events/${eventSlug}/kiosks/${kioskId}`, { method: "DELETE" })).response.status, 200);
assert.equal((await kiosk.call(`${base}/assistant`, { method: "POST", body: JSON.stringify({ message: "وين أقرب مصلى؟" }) })).response.status, 404);
const refused = await json(`${baseUrl}${base}/session`, { method: "POST", headers: { "content-type": "application/json", "x-wanees-kiosk-token": kioskToken }, body: JSON.stringify({ clientType: "kiosk" }) });
assert.equal(refused.body?.error?.code, "KIOSK_TOKEN_INVALID");
for (const visit of [web, phoneForCall]) await visit.call(`${base}/session`, { method: "DELETE" });
console.log("agent contract passed: web, call and kiosk agree; kiosk origin, no memory, read-only link, revoke");
