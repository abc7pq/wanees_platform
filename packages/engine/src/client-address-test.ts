import assert from "node:assert/strict";
import {
  DIRECT_ADDRESS,
  INVALID_ADDRESS,
  SHORT_CHAIN_ADDRESS,
  parseTrustedProxyHops,
  resolveClientAddress,
} from "./client-address.ts";

const headers = (xff?: string, extra: Record<string, string> = {}) =>
  new Headers({ ...(xff === undefined ? {} : { "x-forwarded-for": xff }), ...extra });

// --- configuration parsing: anything unclear means "trust no proxy"
assert.equal(parseTrustedProxyHops(undefined), 0);
assert.equal(parseTrustedProxyHops(""), 0);
assert.equal(parseTrustedProxyHops("1"), 1);
assert.equal(parseTrustedProxyHops(" 2 "), 2);
for (const bad of ["-1", "1.5", "abc", "99", "true"]) assert.equal(parseTrustedProxyHops(bad), 0, bad);

// --- hops = 0: forwarded headers and x-real-ip are never read
assert.equal(resolveClientAddress(headers("203.0.113.9"), 0), DIRECT_ADDRESS);
assert.equal(resolveClientAddress(headers(undefined, { "x-real-ip": "203.0.113.9" }), 0), DIRECT_ADDRESS);

// --- hops = 1: the address the trusted proxy appended (rightmost) wins
assert.equal(resolveClientAddress(headers("198.51.100.7"), 1), "198.51.100.7");
assert.equal(resolveClientAddress(headers("1.1.1.1, 2.2.2.2, 198.51.100.7"), 1), "198.51.100.7");
assert.equal(resolveClientAddress(headers(undefined, { "x-real-ip": "1.1.1.1" }), 1), SHORT_CHAIN_ADDRESS);

// --- hops = 2: two proxies append; client is second from the right
assert.equal(resolveClientAddress(headers("6.6.6.6, 198.51.100.7, 10.0.0.2"), 2), "198.51.100.7");
assert.equal(resolveClientAddress(headers("10.0.0.2"), 2), SHORT_CHAIN_ADDRESS);

// --- normalization and garbage
assert.equal(resolveClientAddress(headers("::ffff:198.51.100.7"), 1), "198.51.100.7");
assert.equal(resolveClientAddress(headers("198.51.100.7:51234"), 1), "198.51.100.7");
assert.equal(resolveClientAddress(headers("[2001:DB8::1]:443"), 1), "2001:db8::1");
assert.equal(resolveClientAddress(headers("not-an-ip"), 1), INVALID_ADDRESS);
assert.equal(resolveClientAddress(headers(""), 1), SHORT_CHAIN_ADDRESS);

// --- spoofing: 25 session creations in one minute from one real client that
// rotates its own x-forwarded-for, x-real-ip and session token on every request.
// Bucket identity = resolved address only (app/lib/rate-limit.ts, admin/lib/request-security.ts).
const LIMIT = 20; // POST /api/v1/events/{eventSlug}/session
const REAL_CLIENT = "198.51.100.7";
for (const hops of [0, 1, 2]) {
  const buckets = new Map<string, number>();
  const outcomes: boolean[] = [];
  for (let i = 0; i < 25; i += 1) {
    const spoofed = `10.${i}.${i}.${i}, 172.16.${i}.1`;
    const appended = hops === 0 ? [] : hops === 1 ? [REAL_CLIENT] : [REAL_CLIENT, "10.0.0.2"];
    const chain = [spoofed, ...appended].join(", ");
    const request = headers(chain, { "x-real-ip": `192.0.2.${i}`, "x-wanees-session-token": `forged-${i}` });
    const key = `session:create:demo:${resolveClientAddress(request, hops)}`;
    const count = (buckets.get(key) ?? 0) + 1;
    buckets.set(key, count);
    outcomes.push(count <= LIMIT);
  }
  assert.equal(buckets.size, 1, `hops=${hops}: spoofed headers must not create new buckets`);
  assert.equal(outcomes.filter(Boolean).length, LIMIT, `hops=${hops}: exactly ${LIMIT} allowed`);
  assert.deepEqual(outcomes.slice(LIMIT), [false, false, false, false, false], `hops=${hops}: 21st+ blocked`);
}

// --- two genuinely different clients behind the same proxy keep separate buckets
assert.notEqual(
  resolveClientAddress(headers("198.51.100.7"), 1),
  resolveClientAddress(headers("198.51.100.8"), 1),
);

console.log("client-address trusted-proxy + spoof resistance passed");
