import assert from "node:assert/strict";
import { MAX_PER_PASS, SENT_HISTORY, mergeSent, nudgeTtlSeconds, nudgeUrgency, nudgesToSend, pushPayload, pushSubscribeSchema } from "./push-nudges.ts";

const show = { id: "show_soon:dolphinarium:1110", kind: "show_soon", text: "«عرض الدولفيناريوم» يبدأ 18:30، بعد 10 دقائق. تحرك الحين.", targetId: "dolphinarium", ui: [] };
const ending = { id: "visit_ending:1200", kind: "visit_ending", text: "باقي 20 دقيقة على نهاية زيارتك، وعندك 3 محطات باقية. تبي أقصّر الجولة على الأهم؟", ui: [] };
const last = { id: "visit_ending:1210", kind: "visit_ending", text: "باقي 10 دقائق على نهاية زيارتك. استمتع بآخرها!", ui: [] };

// ————— Which nudges a device still needs —————
assert.deepEqual(nudgesToSend([show, ending], []).map((n) => n.id), [show.id, ending.id]);
assert.deepEqual(nudgesToSend([show, ending], [show.id]).map((n) => n.id), [ending.id], "a nudge the app or lock screen already delivered is not repeated");
assert.equal(nudgesToSend([show, ending, last], []).length, MAX_PER_PASS, "bounded per pass");
assert.deepEqual(nudgesToSend([], ["x"]), []);

// ————— Bounded, ordered history —————
assert.deepEqual(mergeSent(["a", "b"], ["b", "c"]), ["a", "b", "c"]);
const long = Array.from({ length: SENT_HISTORY + 5 }, (_, i) => `n${i}`);
assert.equal(mergeSent(long, ["new"]).length, SENT_HISTORY);
assert.equal(mergeSent(long, ["new"]).at(-1), "new", "the newest id is kept");

// ————— TTL ends when the moment passes —————
assert.equal(nudgeTtlSeconds(show, 1100), 600, "10 minutes before the show");
assert.equal(nudgeTtlSeconds(show, 1109.5), 60, "never below a minute");
assert.equal(nudgeTtlSeconds({ ...show, id: "show_soon:x:2000" }, 1100), 1800, "never above 30 minutes");
assert.equal(nudgeTtlSeconds({ ...show, id: "odd" }, 1100), 300);
assert.equal(nudgeUrgency(show), "high");
assert.equal(nudgeUrgency(ending), "normal");

// ————— Payload: plain text, same-origin deep link, matching actions —————
const payload = pushPayload(show, "/events/boulevard-world-demo");
assert.equal(payload.v, 1);
assert.equal(payload.title, "العرض بيبدأ قريب");
assert.equal(payload.body, show.text);
assert.equal(payload.url, "/events/boulevard-world-demo?nudge=show_soon%3Adolphinarium%3A1110");
assert.deepEqual(payload.actions.map((a) => a.action), ["get_directions", "show_on_map"]);
assert.ok(!("ui" in payload), "A2UI stays in the app; the notification carries text only");
assert.ok(Buffer.byteLength(JSON.stringify(payload)) < 1500, "fits comfortably in one push record");
assert.deepEqual(pushPayload(ending, "/demo").actions.map((a) => a.action), ["shorten_plan"]);
assert.deepEqual(pushPayload(last, "/demo").actions, [], "no shorten button when one stop is left");

// ————— Subscribe validation —————
const valid = { subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/abc", expirationTime: null, keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) } } };
assert.equal(pushSubscribeSchema.parse(valid).openPath, "/demo");
assert.equal(pushSubscribeSchema.safeParse({ ...valid, openPath: "https://evil.example" }).success, false, "notifications only reopen visitor guide paths");
assert.equal(pushSubscribeSchema.safeParse({ ...valid, openPath: "//evil.example" }).success, false);
assert.equal(pushSubscribeSchema.safeParse({ ...valid, openPath: "/events/boulevard-world-demo" }).success, true);
assert.equal(pushSubscribeSchema.safeParse({ ...valid, openPath: "/e/boulevard-world-demo" }).success, true, "the canonical visitor address reopens");
assert.equal(pushSubscribeSchema.safeParse({ ...valid, openPath: "/e/boulevard-world-demo/plan" }).success, true);
assert.equal(pushSubscribeSchema.safeParse({ ...valid, openPath: "/e/boulevard-world-demo/admin" }).success, false, "only visitor screens");
assert.equal(pushSubscribeSchema.safeParse({ ...valid, seenNudgeIds: ["<script>"] }).success, false);
assert.equal(pushSubscribeSchema.safeParse({ ...valid, name: "x" }).success, false, "no extra fields (no personal data)");
assert.equal(pushSubscribeSchema.safeParse({ ...valid, subscription: { ...valid.subscription, keys: { p256dh: "short", auth: "A".repeat(22) } } }).success, false);

console.log("lock-screen nudge selection, payload and subscription validation tests passed");
