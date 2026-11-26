// اختبار هوية الزائر المسجّل: تنسيق الجوال، الاسم، الإخفاء، كوكي الجهاز، ومحوّلات SMS
import assert from "node:assert/strict";

const identity = await import("./visitor-identity.ts");
const { getSmsVerifier } = await import("./sms/index.ts");

// --- رقم الجوال السعودي ---
for (const input of ["0512345678", "512345678", "+966512345678", "966512345678", "00966512345678",
  "05 1234 5678", "+966-51-234-5678", "(051) 234.5678", "٠٥١٢٣٤٥٦٧٨", "۰۵۱۲۳۴۵۶۷۸"]) {
  assert.equal(identity.normalizeSaudiMobile(input), "+966512345678", `should normalize ${input}`);
}
for (const input of ["0412345678", "05123456", "051234567890", "+971512345678", "abc", "", null, 512345678,
  "+966 5 1234 5678 ext 9", "0512345678'; drop"]) {
  assert.equal(identity.normalizeSaudiMobile(input), null, `should reject ${String(input)}`);
}

// --- الإخفاء: لا يظهر الرقم كاملًا أبدًا ---
assert.equal(identity.maskPhone("+966512345678"), "+9665•••••678");
assert.doesNotMatch(identity.maskPhone("+966512345678"), /12345/);
assert.equal(identity.maskPhone("not-a-phone"), "•••");

// --- الاسم ---
assert.equal(identity.cleanVisitorName("  عبدالرحمن   العنزي "), "عبدالرحمن العنزي");
assert.equal(identity.cleanVisitorName("Sara O'Neil"), "Sara O'Neil");
assert.equal(identity.cleanVisitorName("نورة-القحطاني"), "نورة-القحطاني");
for (const bad of ["ا", "a".repeat(61), "Ali123", "http://x.y", "<script>", "علي ٣", "", null]) {
  assert.equal(identity.cleanVisitorName(bad), null, `should reject name ${String(bad)}`);
}

// --- كوكي وتوكن الجهاز ---
const tokens = new Set(Array.from({ length: 10 }, () => identity.createDeviceToken()));
assert.equal(tokens.size, 10);
assert.equal(identity.hashDeviceToken("t").length, 64);
const cookieRequest = new Request("http://localhost:3100/x", { headers: { cookie: `a=1; ${identity.VISITOR_DEVICE_COOKIE}=tok%2B1` } });
assert.equal(identity.readDeviceToken(cookieRequest), "tok+1");
assert.equal(identity.readDeviceToken(new Request("http://localhost/x", { headers: { "x-wanees-visitor-token": " nat " } })), "nat");
assert.equal(identity.readDeviceToken(new Request("http://localhost/x")), null);
const set = identity.setDeviceCookie(new Response(null), "abc").headers.get("set-cookie");
assert.match(set, /HttpOnly/);
assert.match(set, /SameSite=Lax/);
assert.match(set, new RegExp(`Max-Age=${identity.VISITOR_DEVICE_TTL_SECONDS}`));
assert.match(identity.setDeviceCookie(new Response(null), "abc", identity.SHORT_DEVICE_TTL_SECONDS).headers.get("set-cookie"), /Max-Age=86400(?:;|$)/);
assert.match(identity.clearDeviceCookie(new Response(null)).headers.get("set-cookie"), /Max-Age=0/);
assert.notEqual(identity.phoneScope("otp", "+966512345678"), identity.phoneScope("otp", "+966512345679"));
assert.doesNotMatch(identity.phoneScope("otp", "+966512345678"), /512345678/);

// --- مفتاح الجوال للحدّ: HMAC بسرّ، فما يُعكس بتجربة كل الأرقام ---
assert.notEqual(identity.phoneScope("otp", "+966512345678", "salt-a"), identity.phoneScope("otp", "+966512345678", "salt-b"));
assert.equal(identity.phoneScope("otp", "+966512345678", "s"), identity.phoneScope("otp", "+966512345678", "s"));

// --- ميزانية رسائل SMS لكل جوال: ٦٠ ثانية بين الرموز، ٣ كل ١٠ دقائق، ١٠ باليوم ---
const now = new Date("2026-11-26T12:00:00Z");
const ago = (seconds) => new Date(now.getTime() - seconds * 1000);
assert.deepEqual(identity.otpSendBudget([], now), { allowed: true });
const tooSoon = identity.otpSendBudget([ago(20)], now);
assert.equal(tooSoon.allowed, false);
assert.equal(tooSoon.retryAfterSeconds, 40);
assert.deepEqual(identity.otpSendBudget([ago(61)], now), { allowed: true });
const threeIn10 = identity.otpSendBudget([ago(100), ago(200), ago(300)], now);
assert.equal(threeIn10.allowed, false, "a fourth code within 10 minutes is refused");
assert.equal(threeIn10.retryAfterSeconds, 300, "waits until the oldest of the three leaves the window");
assert.deepEqual(identity.otpSendBudget([ago(700), ago(800), ago(900)], now), { allowed: true });
const tenToday = Array.from({ length: 10 }, (_, index) => ago(3600 * (index + 1)));
assert.equal(identity.otpSendBudget(tenToday, now).allowed, false, "the daily cap holds");
assert.deepEqual(identity.otpSendBudget([ago(25 * 3600)], now), { allowed: true }, "older than a day does not count");

// --- حماية login-CSRF: طلب من موقع آخر أو بغير JSON يُرفض، والتطبيق الأصلي يمر ---
const h = (values) => new Headers(values);
const url = "http://127.0.0.1:3100/api/v1/events/x/visitor/otp/verify";
assert.equal(identity.isCrossSiteRequest(h({ "content-type": "application/json", origin: "http://127.0.0.1:3100", host: "127.0.0.1:3100" }), url), false);
assert.equal(identity.isCrossSiteRequest(h({ "content-type": "application/json", "sec-fetch-site": "same-origin" }), url), false);
assert.equal(identity.isCrossSiteRequest(h({ "content-type": "application/json" }), url), false, "native clients send no Origin");
assert.equal(identity.isCrossSiteRequest(h({ "content-type": "application/json", origin: "https://attacker.example", host: "127.0.0.1:3100" }), url), true);
assert.equal(identity.isCrossSiteRequest(h({ "content-type": "application/json", "sec-fetch-site": "cross-site" }), url), true);
assert.equal(identity.isCrossSiteRequest(h({ "content-type": "text/plain" }), url), true, "a text/plain form post is refused");
assert.equal(identity.isCrossSiteRequest(h({}), url, false), false, "DELETE without a body needs no JSON");
assert.equal(identity.isCrossSiteRequest(h({ origin: "https://wanees.win", "x-forwarded-proto": "https", "x-forwarded-host": "wanees.win" }), url, false), false, "behind the proxy");

// --- مزوّد الاختبار ممنوع في بناء الإنتاج إلا بتصريح صريح (CI) ---
assert.equal(identity.testSmsAllowed({}), true);
assert.equal(identity.testSmsAllowed({ NODE_ENV: "production" }), false);
assert.equal(identity.testSmsAllowed({ NODE_ENV: "production", WANEES_ALLOW_TEST_SMS: "true" }), true);

// --- مزوّد الاختبار: يعمل على localhost فقط، ولا يعمل خلف الـ proxy العام ---
const local = new Request("http://localhost:3100/api", { headers: { host: "localhost:3100" } });
const publicHost = new Request("http://127.0.0.1:3100/api", { headers: { host: "wanees.win" } });
const spoofed = new Request("http://127.0.0.1:3100/api", { headers: { host: "127.0.0.1:3100", "x-forwarded-host": "wanees.win" } });
const testEnv = { WANEES_SMS_PROVIDER: "test", WANEES_TEST_OTP_CODE: "246810" };
const verifier = getSmsVerifier(local, testEnv);
assert.equal(verifier?.provider, "test");
assert.deepEqual(await verifier.start("+966512345678"), { ok: true });
assert.equal(await verifier.check("+966512345678", "246810"), "approved");
assert.equal(await verifier.check("+966512345678", "000000"), "invalid");
assert.equal(getSmsVerifier(publicHost, testEnv), null, "test codes must never work on the public hostname");
assert.equal(getSmsVerifier(spoofed, testEnv), null, "a forwarded public host must disable test codes");
assert.equal(getSmsVerifier(local, { WANEES_SMS_PROVIDER: "test" }), null, "test provider needs an explicit code");
assert.equal(getSmsVerifier(local, { ...testEnv, NODE_ENV: "production" }), null, "a production build refuses fixed codes");
assert.equal(getSmsVerifier(local, { ...testEnv, WANEES_TEST_OTP_CODE: "1234" }), null, "test codes are 6 digits");
assert.equal(getSmsVerifier(local, {}), null, "no provider configured means SMS is unavailable");

// --- Twilio Verify: شكل الطلب ونتائج الاستجابة، مع fetch وهمي ---
const twilioEnv = {
  WANEES_SMS_PROVIDER: "twilio",
  TWILIO_ACCOUNT_SID: "AC00000000000000000000000000000000",
  TWILIO_AUTH_TOKEN: "test-auth-token",
  TWILIO_VERIFY_SERVICE_SID: "VA0123456789abcdef0123456789abcdef",
};
const calls = [];
let next = { status: 201, body: { status: "pending" } };
const fakeFetch = async (url, init) => {
  calls.push({ url, init });
  return new Response(JSON.stringify(next.body), { status: next.status, headers: { "content-type": "application/json" } });
};
const twilio = getSmsVerifier(publicHost, twilioEnv, fakeFetch);
assert.equal(twilio?.provider, "twilio");
assert.deepEqual(await twilio.start("+966512345678"), { ok: true });
assert.equal(calls[0].url, "https://verify.twilio.com/v2/Services/VA0123456789abcdef0123456789abcdef/Verifications");
assert.equal(calls[0].init.method, "POST");
assert.equal(calls[0].init.headers.authorization, `Basic ${Buffer.from("AC00000000000000000000000000000000:test-auth-token").toString("base64")}`);
const startForm = new URLSearchParams(calls[0].init.body);
assert.equal(startForm.get("To"), "+966512345678");
assert.equal(startForm.get("Channel"), "sms");
assert.equal(startForm.get("Locale"), "ar");

next = { status: 200, body: { status: "approved" } };
assert.equal(await twilio.check("+966512345678", "123456"), "approved");
assert.match(calls[1].url, /\/VerificationCheck$/);
assert.equal(new URLSearchParams(calls[1].init.body).get("Code"), "123456");
next = { status: 200, body: { status: "pending" } };
assert.equal(await twilio.check("+966512345678", "999999"), "invalid");
next = { status: 404, body: {} };
assert.equal(await twilio.check("+966512345678", "123456"), "expired");
next = { status: 429, body: {} };
assert.equal(await twilio.check("+966512345678", "123456"), "rate_limited");
assert.deepEqual(await twilio.start("+966512345678"), { ok: false, reason: "rate_limited" });
next = { status: 500, body: {} };
assert.deepEqual(await twilio.start("+966512345678"), { ok: false, reason: "unavailable" });
const throwing = getSmsVerifier(publicHost, twilioEnv, async () => { throw new Error("offline"); });
assert.equal(await throwing.check("+966512345678", "1"), "unavailable");
assert.equal(getSmsVerifier(publicHost, { ...twilioEnv, TWILIO_VERIFY_SERVICE_SID: "bad" }, fakeFetch), null);
assert.equal(getSmsVerifier(publicHost, { ...twilioEnv, TWILIO_AUTH_TOKEN: "" }, fakeFetch), null);

console.log("visitor identity and SMS verifier tests passed");
