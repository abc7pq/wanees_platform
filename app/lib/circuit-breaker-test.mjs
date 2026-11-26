import assert from "node:assert/strict";
import { BreakerRegistry, CircuitBreaker, VISITOR_BREAKER } from "./circuit-breaker.ts";

// Audit 6.2: 5 failures in 60 s open the breaker for 30 s; then exactly one trial decides.
const breaker = new CircuitBreaker(VISITOR_BREAKER);
let now = 1_000_000;
for (let i = 0; i < 4; i += 1) { assert.equal(breaker.allow(now), true); breaker.failure(now); now += 1000; }
assert.equal(breaker.state(now), "closed", "four failures keep it closed");
breaker.failure(now);
assert.equal(breaker.state(now), "open");
assert.equal(breaker.allow(now + 29_000), false, "open for 30 s");
now += 30_000;
assert.equal(breaker.state(now), "half_open");
assert.equal(breaker.allow(now), true, "one trial");
assert.equal(breaker.allow(now), false, "only one trial at a time");
breaker.failure(now);
assert.equal(breaker.state(now + 1000), "open", "a failed trial opens it again");
now += 30_000;
assert.equal(breaker.allow(now), true);
breaker.success(now);
assert.equal(breaker.state(now), "closed", "a good trial closes it");
assert.equal(breaker.allow(now), true);

// Failures spread out over more than a minute never open it.
const slow = new CircuitBreaker(VISITOR_BREAKER);
for (let i = 0; i < 10; i += 1) slow.failure(i * 20_000);
assert.equal(slow.state(200_000), "closed");

// release() gives back an unused half-open trial.
const shared = new CircuitBreaker({ failureThreshold: 1, windowMs: 1000, openMs: 10 });
shared.failure(0);
assert.equal(shared.allow(20), true);
shared.release();
assert.equal(shared.allow(20), true, "released trial can be taken again");

// One visitor's failures do not touch another's breaker; the registry stays bounded.
const registry = new BreakerRegistry(VISITOR_BREAKER, 10, 1000);
for (let i = 0; i < 5; i += 1) registry.get("a", 0).failure(i);
assert.equal(registry.get("a", 10).state(10), "open");
assert.equal(registry.get("b", 10).state(10), "closed");
for (let i = 0; i < 50; i += 1) registry.get(`v${i}`, 5000 + i).allow(5000 + i);
assert.ok(registry.size <= 10, `registry stays bounded (${registry.size})`);

console.log("circuit breaker ok");
