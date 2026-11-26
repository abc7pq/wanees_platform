// Runs the real public/sw.js in a VM with a fake ServiceWorkerGlobalScope and fires push / click events.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function load({ windows = [] } = {}) {
  const listeners = {};
  const shown = [];
  const opened = [];
  const scope = {
    location: new URL("https://wanees.example/sw.js"),
    addEventListener: (type, fn) => { listeners[type] = fn; },
    registration: { showNotification: async (title, options) => { shown.push({ title, options }); }, pushManager: null },
    clients: { matchAll: async () => windows, openWindow: async (path) => { opened.push(path); }, claim: async () => {} },
    skipWaiting: () => {},
  };
  scope.self = scope;
  vm.runInNewContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), { ...scope, URL, Set, Array, String, Date, JSON, Promise, Headers, Response, caches: {}, fetch: () => {} });
  async function fire(type, event) {
    let pending = Promise.resolve();
    listeners[type]({ ...event, waitUntil: (p) => { pending = p; } });
    await pending;
  }
  return { fire, shown, opened };
}

const payload = { v: 1, id: "show_soon:dolphinarium:1110", kind: "show_soon", title: "العرض بيبدأ قريب", body: "«عرض الدولفيناريوم» يبدأ 18:30.", url: "/demo?nudge=show_soon%3Adolphinarium%3A1110", actions: [{ action: "get_directions", title: "دلّني" }, { action: "show_on_map", title: "على الخريطة" }, { action: "evil", title: "x" }] };
const data = (value) => ({ data: { json: () => value } });

// ————— push → one RTL Arabic notification, tagged by nudge id —————
{
  const messages = [];
  const sw = load({ windows: [{ url: "https://wanees.example/demo", postMessage: (m) => messages.push(JSON.parse(JSON.stringify(m))) }] });
  await sw.fire("push", data(payload));
  assert.equal(sw.shown.length, 1);
  const { title, options } = sw.shown[0];
  assert.equal(title, "العرض بيبدأ قريب");
  assert.equal(options.body, payload.body);
  assert.equal(options.tag, payload.id, "the same nudge replaces itself instead of stacking");
  assert.equal(options.dir, "rtl");
  assert.equal(options.lang, "ar");
  assert.deepEqual([...options.actions].map((a) => a.action), ["get_directions", "show_on_map"], "only known actions, at most two");
  assert.equal(options.data.url, payload.url);
  assert.deepEqual(messages, [{ type: "wanees:nudge", id: payload.id }], "an open guide is told to check now");
}

// ————— malformed or foreign payloads show nothing; cross-origin URLs are pinned to this origin —————
{
  const sw = load();
  await sw.fire("push", data({ title: "x" }));
  await sw.fire("push", { data: { json: () => { throw new Error("not json"); } } });
  assert.equal(sw.shown.length, 0);
  await sw.fire("push", data({ ...payload, url: "https://evil.example/phish" }));
  assert.equal(sw.shown[0].options.data.url, "/demo", "a foreign URL falls back to the guide on this origin");
}

// ————— click → open the guide (or focus it) with the chosen action —————
{
  const sw = load();
  let closed = false;
  await sw.fire("notificationclick", { action: "get_directions", notification: { close: () => { closed = true; }, data: { url: payload.url } } });
  assert.ok(closed);
  assert.deepEqual([...sw.opened], ["/demo?nudge=show_soon%3Adolphinarium%3A1110&do=get_directions"]);
}
{
  const messages = [];
  let focused = false;
  const sw = load({ windows: [{ url: "https://wanees.example/demo", focus: async () => { focused = true; }, postMessage: (m) => messages.push(JSON.parse(JSON.stringify(m))) }] });
  await sw.fire("notificationclick", { action: "", notification: { close() {}, data: { url: payload.url } } });
  assert.ok(focused, "an already open guide is focused, not duplicated");
  assert.equal(sw.opened.length, 0);
  assert.deepEqual(messages, [{ type: "wanees:open-nudge", path: "/demo?nudge=show_soon%3Adolphinarium%3A1110" }]);
}
{
  const sw = load();
  await sw.fire("notificationclick", { action: "drop_tables", notification: { close() {}, data: { url: "javascript:alert(1)" } } });
  assert.deepEqual([...sw.opened], ["/demo"], "unknown actions are ignored and odd URLs fall back to the guide");
}

console.log("service worker lock-screen push and click tests passed");
