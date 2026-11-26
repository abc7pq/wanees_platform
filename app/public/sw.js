// WANEES visitor service worker: keeps the guide usable when the venue's mobile network drops.
//
// - App shell and Next's immutable static files: cache-first.
// - Pages (/demo, /e/…, /events/…): network-first, falling back to the last copy.
// - A short allowlist of visitor GET APIs (event catalog, session, itinerary): network-first with a
//   cached fallback marked `x-wanees-offline: 1`. Live state (/live) is never served from cache, so the
//   app keeps saying «آخر تحديث محفوظ» instead of pretending crowd data is current.
// - Nothing else is cached: no POSTs, no assistant, presence, analytics or admin traffic.
// - Ending a visit (DELETE …/session), deleting the registered visitor (DELETE …/visitor/me) or
//   forgetting this device (POST …/visitor/logout) clears the cached visitor data on this device and
//   drops its lock-screen subscription.
// - Lock-screen nudges: an encrypted Web Push carries one deterministic nudge; tapping it reopens the guide
//   (or its «دلّني» / «على الخريطة» action) on this origin only.
const VERSION = "wanees-v2"; // v2: identity-guide icons and logo
const SHELL = `${VERSION}-shell`;
const STATIC = `${VERSION}-static`;
const VISIT = `${VERSION}-visit`;
const SHELL_URLS = ["/demo", "/manifest.webmanifest", "/icon-192.png", "/icon.png", "/brand/logo.webp"];
const VISIT_APIS = [
  /^\/api\/events\/[^/]+$/,
  /^\/api\/v1\/events\/[^/]+\/session$/,
  /^\/api\/v1\/events\/[^/]+\/itinerary$/,
];
// Requests after which nothing about this visitor may stay on the device.
const VISIT_ENDING = [
  ["DELETE", /^\/api\/v1\/events\/[^/]+\/session$/],
  ["DELETE", /^\/api\/v1\/events\/[^/]+\/visitor\/me$/],
  ["POST", /^\/api\/v1\/events\/[^/]+\/visitor\/logout$/],
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(SHELL_URLS)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

function offlineCopy(response) {
  const headers = new Headers(response.headers);
  headers.set("x-wanees-offline", "1");
  return response.blob().then((body) => new Response(body, { status: response.status, statusText: response.statusText, headers }));
}

async function networkFirst(request, cacheName, { markOffline = false } = {}) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone()).catch(() => {});
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreVary: true });
    if (!cached) throw error;
    return markOffline ? offlineCopy(cached) : cached;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone()).catch(() => {});
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (VISIT_ENDING.some(([method, pattern]) => request.method === method && pattern.test(url.pathname))) {
    event.respondWith(fetch(request).finally(() => Promise.all([
      caches.delete(VISIT),
      self.registration?.pushManager?.getSubscription().then((subscription) => subscription?.unsubscribe()).catch(() => {}),
    ])));
    return;
  }
  if (request.method !== "GET") return;

  if (url.pathname.startsWith("/_next/static/") || /\.(?:png|svg|webmanifest|woff2?)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (VISIT_APIS.some((pattern) => pattern.test(url.pathname))) {
    event.respondWith(networkFirst(request, VISIT, { markOffline: true }));
    return;
  }
  if (request.mode === "navigate" && (url.pathname === "/demo" || url.pathname.startsWith("/e/") || url.pathname.startsWith("/events/"))) {
    event.respondWith(networkFirst(request, SHELL).catch(async () => (await caches.match("/demo")) ?? Response.error()));
  }
});

// ————— Lock-screen nudges —————

const NUDGE_ACTIONS = new Set(["get_directions", "show_on_map", "shorten_plan"]);

function sameOriginPath(value) {
  try {
    const url = new URL(value || "/demo", self.location.origin);
    return url.origin === self.location.origin ? url : new URL("/demo", self.location.origin);
  } catch {
    return new URL("/demo", self.location.origin);
  }
}

self.addEventListener("push", (event) => {
  let nudge = null;
  try {
    nudge = event.data ? event.data.json() : null;
  } catch {
    nudge = null;
  }
  if (!nudge || nudge.v !== 1 || typeof nudge.title !== "string" || typeof nudge.body !== "string") return;
  event.waitUntil((async () => {
    // An open guide shows the same nudge in its chat; let it check right away.
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) client.postMessage({ type: "wanees:nudge", id: nudge.id });
    await self.registration.showNotification(nudge.title, {
      body: nudge.body,
      tag: String(nudge.id || "wanees-nudge"),
      lang: "ar",
      dir: "rtl",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      timestamp: Date.now(),
      data: { url: sameOriginPath(nudge.url).pathname + sameOriginPath(nudge.url).search },
      actions: Array.isArray(nudge.actions)
        ? nudge.actions.filter((item) => item && NUDGE_ACTIONS.has(item.action) && typeof item.title === "string").slice(0, 2)
        : [],
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = sameOriginPath(event.notification.data?.url);
  if (event.action && NUDGE_ACTIONS.has(event.action)) target.searchParams.set("do", event.action);
  const path = target.pathname + target.search;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = windows.find((client) => new URL(client.url).pathname === target.pathname);
    if (open) {
      await open.focus();
      open.postMessage({ type: "wanees:open-nudge", path });
      return;
    }
    await self.clients.openWindow(path);
  })());
});
