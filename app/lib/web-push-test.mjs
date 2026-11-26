import assert from "node:assert/strict";
import { createDecipheriv, createECDH, createHmac, createPublicKey, verify } from "node:crypto";
import { b64url, encryptPushPayload, endpointHash, fromB64url, generateVapidKeys, isAllowedPushEndpoint, sendWebPush, vapidAuthorization, vapidConfig } from "./web-push.ts";

// ————— RFC 8291 §5 test vector: byte-exact encryption —————
const vector = encryptPushPayload("When I grow up, I want to be a watermelon", {
  p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
}, { salt: fromB64url("DGv6ra1nlYgDCS1FRnbzlw"), serverPrivateKey: fromB64url("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw") });
assert.equal(
  vector.toString("base64url"),
  "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
  "encryption matches the RFC 8291 example byte for byte",
);

// ————— Round trip: a browser key pair decrypts an Arabic payload —————
const browser = createECDH("prime256v1");
browser.generateKeys();
const auth = Buffer.alloc(16, 7);
const keys = { p256dh: b64url(browser.getPublicKey()), auth: b64url(auth) };
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();
function decrypt(body) {
  const salt = body.subarray(0, 16);
  const idLength = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idLength);
  const sealed = body.subarray(21 + idLength);
  const secret = browser.computeSecret(asPublic);
  const ikm = hmac(hmac(auth, secret), Buffer.concat([Buffer.from("WebPush: info\0"), browser.getPublicKey(), asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const decipher = createDecipheriv("aes-128-gcm", hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01", "binary")).subarray(0, 16), hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01", "binary")).subarray(0, 12));
  decipher.setAuthTag(sealed.subarray(-16));
  const plain = Buffer.concat([decipher.update(sealed.subarray(0, -16)), decipher.final()]);
  assert.equal(plain.at(-1), 2, "single record ends with the last-record delimiter");
  return plain.subarray(0, -1).toString("utf8");
}
const message = JSON.stringify({ title: "ونيس", body: "«عرض الدولفيناريوم» يبدأ 18:30. تحرك الحين." });
const first = encryptPushPayload(message, keys);
assert.equal(decrypt(first), message);
assert.notDeepEqual(first.subarray(0, 16), encryptPushPayload(message, keys).subarray(0, 16), "every message gets a fresh salt");
assert.throws(() => encryptPushPayload("x".repeat(5000), keys), /too large/);
assert.throws(() => encryptPushPayload("x", { p256dh: "AAAA", auth: keys.auth }), /p256dh/);

// ————— VAPID: the JWT verifies with the advertised public key —————
const pair = generateVapidKeys();
const vapid = { ...pair, subject: "mailto:ops@example.org" };
const header = vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", vapid, 1_000_000);
const [, token, key] = header.match(/^vapid t=([^,]+), k=(.+)$/) ?? [];
assert.equal(key, pair.publicKey);
const [h, c, s] = token.split(".");
const claims = JSON.parse(fromB64url(c).toString());
assert.deepEqual(claims, { aud: "https://fcm.googleapis.com", exp: 1_000_000 + 12 * 3600, sub: "mailto:ops@example.org" });
const point = fromB64url(pair.publicKey);
const publicKey = createPublicKey({ format: "jwk", key: { kty: "EC", crv: "P-256", x: b64url(point.subarray(1, 33)), y: b64url(point.subarray(33)) } });
assert.ok(verify("sha256", Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, fromB64url(s)), "ES256 signature verifies");

assert.equal(vapidConfig({}), null, "no keys → push disabled");
assert.equal(vapidConfig({ WANEES_VAPID_PUBLIC_KEY: "abc", WANEES_VAPID_PRIVATE_KEY: "def" }), null, "malformed keys → push disabled");
assert.equal(vapidConfig({ WANEES_VAPID_PUBLIC_KEY: pair.publicKey, WANEES_VAPID_PRIVATE_KEY: pair.privateKey })?.subject, "mailto:push@wanees.invalid");

// ————— Endpoint allowlist (no SSRF through a forged subscription) —————
for (const ok of ["https://fcm.googleapis.com/fcm/send/x", "https://updates.push.services.mozilla.com/wpush/v2/x", "https://web.push.apple.com/QO", "https://db5p.notify.windows.com/w/?token=x"]) {
  assert.equal(isAllowedPushEndpoint(ok, {}), true, ok);
}
for (const bad of ["http://fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "https://evil.example/fcm.googleapis.com", "https://fcm.googleapis.com.evil.example/x", "https://user:pw@fcm.googleapis.com/x", "https://169.254.169.254/latest", "http://localhost:9999/push", "not a url"]) {
  assert.equal(isAllowedPushEndpoint(bad, {}), false, bad);
}
assert.equal(isAllowedPushEndpoint("http://127.0.0.1:9999/push/1", { WANEES_PUSH_EXTRA_HOSTS: "127.0.0.1:9999" }), true, "a local test push service can be allowed explicitly");
assert.equal(isAllowedPushEndpoint("http://127.0.0.1:9999/push/1", { WANEES_PUSH_EXTRA_HOSTS: "127.0.0.1:9999", NODE_ENV: "production" }), false, "never plain http in production");
assert.equal(endpointHash("a").length, 64);

// ————— Sending: headers, gone subscriptions, refused hosts —————
const sent = [];
const fakeFetch = async (url, init) => { sent.push({ url, init }); return new Response(null, { status: url.endsWith("/gone") ? 410 : 201 }); };
const ok = await sendWebPush({ subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/live", keys }, payload: message, vapid, ttlSeconds: 300, urgency: "high", topic: "leave_now:dolphinarium:1110", fetchImpl: fakeFetch });
assert.deepEqual(ok, { ok: true, status: 201, gone: false });
const headers = sent[0].init.headers;
assert.equal(headers["Content-Encoding"], "aes128gcm");
assert.equal(headers.TTL, "300");
assert.equal(headers.Urgency, "high");
assert.equal(headers.Topic, "leave_nowdolphinarium1110", "topic is reduced to URL-safe characters");
assert.match(headers.Authorization, /^vapid t=/);
assert.equal(sent[0].init.redirect, "error", "a push service redirect is never followed");
assert.equal(decrypt(Buffer.from(sent[0].init.body)), message, "the body on the wire is the encrypted payload");
assert.equal((await sendWebPush({ subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/gone", keys }, payload: "x", vapid, ttlSeconds: 60, fetchImpl: fakeFetch })).gone, true);
const before = sent.length;
assert.equal((await sendWebPush({ subscription: { endpoint: "https://evil.example/x", keys }, payload: "x", vapid, ttlSeconds: 60, fetchImpl: fakeFetch })).ok, false);
assert.equal(sent.length, before, "a disallowed endpoint is never contacted");

console.log("web push encryption, VAPID, endpoint allowlist and sender tests passed");
