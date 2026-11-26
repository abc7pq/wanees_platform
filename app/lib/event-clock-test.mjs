// The clock override is a CI/dev tool only. It must never move a deployed server's clock.
import assert from "node:assert/strict";
import { clockOverrideMinute } from "./event-clock.ts";

const on = { WANEES_ALLOW_CLOCK_OVERRIDE: "true", WANEES_CLOCK_OVERRIDE_MINUTE: "1080" };

assert.equal(clockOverrideMinute({ ...on, NODE_ENV: "development" }), 1080, "dev honours the override");
assert.equal(clockOverrideMinute({ ...on }), 1080, "unset NODE_ENV honours the override");
assert.equal(clockOverrideMinute({ ...on, NODE_ENV: "production" }), null, "production ignores the override");
assert.equal(clockOverrideMinute({ ...on, NODE_ENV: "production", CI: "true" }), null, "CI=true alone is not enough");
assert.equal(clockOverrideMinute({ ...on, NODE_ENV: "production", GITHUB_ACTIONS: "true" }), null, "GITHUB_ACTIONS alone is not enough");
assert.equal(clockOverrideMinute({ ...on, NODE_ENV: "production", CI: "true", GITHUB_ACTIONS: "true" }), 1080, "the GitHub Actions runner honours it");
assert.equal(clockOverrideMinute({ WANEES_CLOCK_OVERRIDE_MINUTE: "1080", NODE_ENV: "development" }), null, "minute without the allow flag is ignored");
assert.equal(clockOverrideMinute({ ...on, WANEES_ALLOW_CLOCK_OVERRIDE: "1" }), null, "only the exact value 'true' enables it");
for (const bad of ["-1", "1440", "18.5", "abc", ""]) {
  assert.equal(clockOverrideMinute({ ...on, WANEES_CLOCK_OVERRIDE_MINUTE: bad, NODE_ENV: "development" }), null, `invalid minute ${JSON.stringify(bad)} is ignored`);
}
console.log("event-clock override guard: 13 checks passed");
