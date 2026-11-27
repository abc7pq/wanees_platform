// Phone ↔ screen link codes (audit 4.3): format, typing tolerance, hashing and the grant's life.
import assert from "node:assert/strict";
const link = await import("./visitor-link.ts");

const codes = new Set(Array.from({ length: 200 }, () => link.createLinkCode()));
assert.ok(codes.size > 190, "codes must be random");
for (const code of codes) assert.match(code, /^[2-9A-HJKMNP-Z]{6}$/);
assert.equal(link.createLinkCode(() => 0), "222222");

assert.equal(link.normalizeLinkCode("ab3 k7q"), "AB3K7Q");
assert.equal(link.normalizeLinkCode("AB3-K7Q"), "AB3K7Q");
assert.equal(link.normalizeLinkCode("ab٣k٧q"), "AB3K7Q", "Arabic digits are accepted");
assert.equal(link.normalizeLinkCode("AB3K7"), null);
assert.equal(link.normalizeLinkCode("AB3K7O"), null, "O is not in the alphabet");
assert.equal(link.normalizeLinkCode(123456), null);
assert.equal(link.normalizeLinkCode("x".repeat(40)), null);

// The hash binds the code to its event.
assert.notEqual(link.hashLinkCode("event-a", "AB3K7Q"), link.hashLinkCode("event-b", "AB3K7Q"));
assert.match(link.hashLinkCode("event-a", "AB3K7Q"), /^[0-9a-f]{64}$/);

const t0 = new Date("2026-11-27T18:00:00Z");
const at = (ms) => new Date(t0.getTime() + ms);
const fresh = { expiresAt: at(link.LINK_CODE_TTL_MS), redeemedAt: null, lastUsedAt: null, revokedAt: null };
assert.equal(link.linkGrantState(fresh, at(0)), "pending");
assert.equal(link.linkGrantState(fresh, at(link.LINK_CODE_TTL_MS - 1)), "pending");
assert.equal(link.linkGrantState(fresh, at(link.LINK_CODE_TTL_MS)), "expired", "a code lives 10 minutes");
const redeemed = { ...fresh, redeemedAt: at(1000), lastUsedAt: at(1000) };
assert.equal(link.linkGrantState(redeemed, at(1000 + 59_000)), "active");
assert.equal(link.linkGrantState(redeemed, at(1000 + 61_000)), "idle", "a minute without use ends the link");
assert.equal(link.linkGrantState({ ...redeemed, lastUsedAt: at(50_000) }, at(100_000)), "active", "each use keeps it alive");
assert.equal(link.linkGrantState({ ...redeemed, expiresAt: at(-1) }, at(2000)), "active", "the code's expiry does not cut a live screen");
assert.equal(link.linkGrantState({ ...redeemed, revokedAt: at(2000) }, at(2001)), "revoked");
assert.equal(link.linkGrantState({ ...fresh, revokedAt: at(1) }, at(2)), "revoked");

assert.equal(link.linkCodeUrl("https://x.test/", "boulevard-world-demo", "AB3K7Q"), "https://x.test/kiosk/boulevard-world-demo#code=AB3K7Q");
console.log("visitor-link: all assertions passed");
