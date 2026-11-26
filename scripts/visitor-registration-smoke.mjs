// End-to-end check of registered visitors against a running visitor server started with
//   WANEES_FEATURE_VISITOR_REGISTRATION=true WANEES_SMS_PROVIDER=test WANEES_TEST_OTP_CODE=<6 digits>
//   WANEES_ALLOW_TEST_SMS=true (needed because `next start` is a production build)
// and the organizer app. Uses only a fake, per-run phone number and deletes it at the end.
import assert from "node:assert/strict";

const baseUrl = process.env.WANEES_VISITOR_REG_BASE_URL ?? "http://127.0.0.1:3102";
const adminUrl = process.env.WANEES_ADMIN_BASE_URL ?? "http://127.0.0.1:3200";
const code = process.env.WANEES_TEST_OTP_CODE ?? "";
const ownerPassword = process.env.WANEES_OWNER_PASSWORD ?? "";
const eventSlug = "boulevard-world-demo";
const base = `/api/v1/events/${eventSlug}`;
assert.match(code, /^\d{6}$/, "set WANEES_TEST_OTP_CODE to the code the test server accepts");

function createClient(origin) {
  const cookies = new Map();
  return async function call(path, method = "GET", input, expected = 200) {
    const headers = new Headers({ origin });
    if (input !== undefined) headers.set("content-type", "application/json");
    if (cookies.size) headers.set("cookie", [...cookies.values()].join("; "));
    const response = await fetch(origin + path, { method, headers, body: input === undefined ? undefined : JSON.stringify(input) });
    // Decode by hand: Response.text() strips a leading BOM, which the CSV check needs to see.
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await response.arrayBuffer());
    let body = null;
    try { body = JSON.parse(text); } catch { body = null; }
    for (const set of response.headers.getSetCookie()) {
      const pair = set.split(";")[0];
      const name = pair.split("=")[0];
      if (/Max-Age=0/i.test(set)) cookies.delete(name); else cookies.set(name, pair);
    }
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(body?.error ?? text.slice(0, 200))}`);
    return { data: body?.data, body, text, response, cookies };
  };
}

for (let attempt = 0; attempt < 30; attempt += 1) {
  const ok = await fetch(`${baseUrl}/api/health`).then((res) => res.ok).catch(() => false);
  if (ok) break;
  if (attempt === 29) throw new Error(`visitor server at ${baseUrl} is not healthy`);
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

const localPhone = `05${String(Date.now()).slice(-8)}`;
const e164 = `+966${localPhone.slice(1)}`;
const name = `زائر اختبار ${String.fromCharCode(0x0627 + (Date.now() % 20))}`;
const { VISITOR_CONSENT_VERSION } = await import("../packages/contracts/src/index.ts");
const consent = { consent: true, consentVersion: VISITOR_CONSENT_VERSION };

// 1. Registration is required, and nothing starts without it.
const phone1 = createClient(baseUrl);
const me0 = await phone1(`${base}/visitor/me`);
assert.equal(me0.data.registrationRequired, true, "server must run with WANEES_FEATURE_VISITOR_REGISTRATION=true");
assert.equal(me0.data.visitor, null);
const blocked = await phone1(`${base}/session`, "POST", { clientType: "web" }, 401);
assert.equal(blocked.body.error.code, "VISITOR_REGISTRATION_REQUIRED");

// 2. Validation: consent and a Saudi mobile are mandatory.
const noConsent = await phone1(`${base}/visitor/otp/start`, "POST", { name, phone: localPhone, consent: false, consentVersion: consent.consentVersion }, 400);
assert.equal(noConsent.body.error.code, "VISITOR_CONSENT_REQUIRED");
const badPhone = await phone1(`${base}/visitor/otp/start`, "POST", { name, phone: "0412345678", ...consent }, 400);
assert.equal(badPhone.body.error.code, "VISITOR_PHONE_INVALID");

// 3. Code request and verification.
const start = await phone1(`${base}/visitor/otp/start`, "POST", { name, phone: localPhone, ...consent }, 201);
assert.ok(start.data.challengeId);
assert.doesNotMatch(JSON.stringify(start.body), new RegExp(localPhone.slice(2)), "the full phone number must not be echoed back");
const wrong = await phone1(`${base}/visitor/otp/verify`, "POST", { challengeId: start.data.challengeId, code: code === "000000" ? "111111" : "000000" }, 400);
assert.equal(wrong.body.error.code, "OTP_CODE_INVALID");
const verified = await phone1(`${base}/visitor/otp/verify`, "POST", { challengeId: start.data.challengeId, code }, 201);
assert.equal(verified.data.visitor.name, name);
assert.ok(verified.cookies.has("wanees_visitor"), "verify must set the HttpOnly device cookie");
assert.equal(verified.data.visitorToken, undefined, "web clients must not receive the device token in JSON");
const replay = await phone1(`${base}/visitor/otp/verify`, "POST", { challengeId: start.data.challengeId, code }, 404);
assert.equal(replay.body.error.code, "OTP_CHALLENGE_NOT_FOUND", "a used code must not work twice");

// 4. The visit is recorded against the visitor.
const session = await phone1(`${base}/session`, "POST", { clientType: "web", preferences: { companions: "أصدقاء", partySize: 3, mood: "هادئ", availableMinutes: 120 } }, 201);
assert.equal(session.data.registered, true);
await phone1(`${base}/itinerary`, "POST", { generatedReason: "visitor-registration-smoke" }, 201);
await phone1(`${base}/analytics`, "POST", { metricName: "visit_rating", metricValue: 5 }, 202);
const me1 = await phone1(`${base}/visitor/me`);
assert.equal(me1.data.visitor.name, name);
assert.equal(me1.data.visitor.visitCount, 1);
assert.equal(me1.data.preferences?.companions, "أصدقاء", "the last answers are remembered for next time");

// 5. Organizer view: Owner sees the visitor, anonymous requests do not.
const anonymousAdmin = createClient(adminUrl);
await anonymousAdmin("/api/v1/visitors", "GET", undefined, 401);
if (ownerPassword) {
  const owner = createClient(adminUrl);
  await owner("/api/login", "POST", { email: "owner@wanees.demo", password: ownerPassword });
  // Masked by default; the full number needs an explicit, audited reveal.
  const masked = await owner(`/api/v1/visitors?q=${encodeURIComponent(name)}`);
  assert.equal(masked.data.phonesMasked, true);
  assert.equal(masked.text.includes(e164), false, "the default list must not contain full phone numbers");
  const list = await owner(`/api/v1/visitors?q=${encodeURIComponent(name)}&reveal=phone`);
  const row = list.data.visitors.find((item) => item.phone === e164);
  assert.ok(row, "owner must see the registered visitor");
  assert.equal(row.visitCount, 1);
  assert.equal(row.averageRating, 5);
  const detail = await owner(`/api/v1/visitors/${row.id}`);
  assert.equal(detail.data.visits[0].partySize, 3);
  assert.ok(detail.data.visits[0].itineraryActivityKeys.length > 0, "planned activities are kept on the visit");
  const csv = await owner(`/api/v1/visitors?format=csv&q=${encodeURIComponent(name)}&reveal=phone`);
  assert.match(csv.response.headers.get("content-type") ?? "", /text\/csv/);
  assert.ok(csv.text.startsWith("﻿") && csv.text.includes(e164), "CSV must be UTF-8 with BOM and include the visitor");
} else {
  console.log("WANEES_OWNER_PASSWORD not set: organizer visitor list checks skipped");
}

// 6. «لست أنا» forgets the device only; the same phone on a new device is the same visitor.
await phone1(`${base}/visitor/logout`, "POST", {});
assert.equal((await phone1(`${base}/visitor/me`)).data.visitor, null);
const phone2 = createClient(baseUrl);
// The SMS budget is per phone, not per device or IP: a second code within 60 s is refused.
const tooSoon = await phone2(`${base}/visitor/otp/start`, "POST", { name, phone: `+966 ${localPhone.slice(1)}`, ...consent }, 429);
const retryAfter = Number(tooSoon.response.headers.get("retry-after"));
assert.ok(retryAfter >= 1 && retryAfter <= 60, `resend cooldown must be at most 60 s, got ${retryAfter}`);
await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000 + 500));
const start2 = await phone2(`${base}/visitor/otp/start`, "POST", { name, phone: `+966 ${localPhone.slice(1)}`, ...consent }, 201);
await phone2(`${base}/visitor/otp/verify`, "POST", { challengeId: start2.data.challengeId, code }, 201);
assert.equal((await phone2(`${base}/visitor/me`)).data.visitor.visitCount, 1, "same phone, same visitor");

// 7. «احذف بياناتي» removes everything.
const removed = await phone2(`${base}/visitor/me`, "DELETE");
assert.equal(removed.data.deleted, true);
assert.equal((await phone2(`${base}/visitor/me`)).data.visitor, null);
await phone2(`${base}/session`, "POST", { clientType: "web" }, 401);
if (ownerPassword) {
  const owner = createClient(adminUrl);
  await owner("/api/login", "POST", { email: "owner@wanees.demo", password: ownerPassword });
  const after = await owner(`/api/v1/visitors?q=${encodeURIComponent(name)}&reveal=phone`);
  assert.equal(after.data.visitors.some((item) => item.phone === e164), false, "deleted visitor must disappear for the organizer");
}

// 8. Login-CSRF: a cross-site browser request cannot plant a device cookie.
const crossSite = await fetch(`${baseUrl}${base}/visitor/otp/verify`, {
  method: "POST",
  headers: { origin: "https://attacker.example", "content-type": "text/plain" },
  body: JSON.stringify({ challengeId: "x", code: "123456" }),
});
assert.equal(crossSite.status, 403, "cross-site OTP verify must be refused");

console.log("registered visitor flow passed: gate, consent, OTP, resend budget, visit record, organizer view, not-me, delete, cross-site");
