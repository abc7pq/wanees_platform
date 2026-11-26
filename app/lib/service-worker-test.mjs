// Runs app/public/sw.js against a simulated service-worker environment: an in-memory Cache Storage
// and a network that can be switched off. Checks what the visitor can still see without signal and
// that nothing outside the allowlist is ever cached.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../public/sw.js"), "utf8");
const ORIGIN = "https://wanees.test";

// Like the browser, resolve relative URLs against the worker's origin.
const keyOf = (request) => (typeof request === "string" ? new URL(request, ORIGIN).href : request.url);
class MemoryCache {
  constructor() { this.entries = new Map(); }
  async match(request) { const hit = this.entries.get(keyOf(request)); return hit ? hit.clone() : undefined; }
  async put(request, response) { this.entries.set(keyOf(request), response.clone()); }
  async addAll(urls) { for (const url of urls) await this.put(new Request(new URL(url, ORIGIN)), await network(new Request(new URL(url, ORIGIN)))); }
}
const stores = new Map();
const caches = {
  async open(name) { if (!stores.has(name)) stores.set(name, new MemoryCache()); return stores.get(name); },
  async keys() { return [...stores.keys()]; },
  async delete(name) { return stores.delete(name); },
  async match(request) { for (const store of stores.values()) { const hit = await store.match(request); if (hit) return hit; } return undefined; },
};

let online = true;
let served = 0;
async function network(request) {
  if (!online) throw new TypeError("Failed to fetch");
  served += 1;
  const path = new URL(request.url).pathname;
  return new Response(JSON.stringify({ path, served }), { status: 200, headers: { "content-type": "application/json" } });
}

const listeners = {};
const self = {
  location: new URL(ORIGIN),
  addEventListener: (type, handler) => { listeners[type] = handler; },
  skipWaiting: async () => {},
  clients: { claim: async () => {} },
};
vm.runInNewContext(source, { self, caches, fetch: network, Request, Response, Headers, URL, Promise, console });

async function lifecycle(type) {
  let pending;
  listeners[type]({ waitUntil: (promise) => { pending = promise; } });
  await pending;
}
/** Dispatch a fetch event; returns the worker's response, or "passthrough" when it doesn't intercept. */
async function dispatch(path, { method = "GET", mode = "cors" } = {}) {
  const request = new Request(`${ORIGIN}${path}`, { method });
  Object.defineProperty(request, "mode", { value: mode });
  let responded;
  listeners.fetch({ request, respondWith: (promise) => { responded = promise; } });
  return responded === undefined ? "passthrough" : responded;
}

await lifecycle("install");
await lifecycle("activate");
assert.ok(await (await caches.open("wanees-v2-shell")).match(`${ORIGIN}/demo`), "the guide page is precached on install");

// Online: visitor data passes through and is remembered.
const itineraryPath = "/api/v1/events/boulevard-world-demo/itinerary";
const onlinePlan = await dispatch(itineraryPath);
assert.equal(onlinePlan.headers.get("x-wanees-offline"), null, "an online response is not marked offline");
await dispatch("/api/events/boulevard-world-demo");
await dispatch("/api/v1/events/boulevard-world-demo/session");

// Offline: the last plan, catalog and session come from the cache, marked as offline copies.
online = false;
const offlinePlan = await dispatch(itineraryPath);
assert.equal(offlinePlan.status, 200, "the saved plan is still available offline");
assert.equal(offlinePlan.headers.get("x-wanees-offline"), "1", "an offline copy says so");
assert.equal((await offlinePlan.json()).path, itineraryPath);
assert.equal((await dispatch("/api/events/boulevard-world-demo")).headers.get("x-wanees-offline"), "1");
const page = await dispatch("/demo", { mode: "navigate" });
assert.equal(page.status, 200, "the guide page opens offline");
const otherEventPage = await dispatch("/events/boulevard-world-demo", { mode: "navigate" });
assert.equal(otherEventPage.status, 200, "an event page falls back to the cached guide");
assert.equal((await dispatch("/e/boulevard-world-demo/plan", { mode: "navigate" })).status, 200, "a visitor screen opens offline too");

// Live state is never faked from cache.
await assert.rejects(async () => {
  const live = await dispatch("/api/v1/events/boulevard-world-demo/live");
  if (live === "passthrough") throw new TypeError("network");
}, "live crowd state is not served from cache");

// Outside the allowlist the worker stays out of the way.
assert.equal(await dispatch("/api/v1/events/boulevard-world-demo/assistant", { method: "POST" }), "passthrough", "POSTs are never intercepted");
assert.equal(await dispatch("/api/v1/events/boulevard-world-demo/presence"), "passthrough", "presence is never cached");
assert.equal(await dispatch("https://tiles.example.com/1/2/3.png".replace(ORIGIN, "")), "passthrough");

// Ending the visit removes the cached visitor data from this device.
online = true;
await dispatch("/api/v1/events/boulevard-world-demo/session", { method: "DELETE" });
assert.equal(stores.has("wanees-v2-visit"), false, "ending a visit clears cached plan and session");
online = false;
await assert.rejects(async () => dispatch(itineraryPath), "after ending the visit, the old plan is gone");

// Deleting the registered visitor, or «لست أنا» on this device, also clears the cached visitor data.
for (const [method, path] of [["DELETE", "/api/v1/events/boulevard-world-demo/visitor/me"], ["POST", "/api/v1/events/boulevard-world-demo/visitor/logout"]]) {
  online = true;
  await dispatch(itineraryPath);
  assert.equal(stores.has("wanees-v2-visit"), true, "the plan is cached again before the purge");
  await dispatch(path, { method });
  assert.equal(stores.has("wanees-v2-visit"), false, `${method} ${path} clears cached plan and session`);
}
assert.equal(await dispatch("/api/v1/events/boulevard-world-demo/visitor/otp/start", { method: "POST" }), "passthrough", "other visitor POSTs pass through untouched");

console.log("service worker offline behaviour: all assertions passed");
