// An invited member must replace the one-time password before any session is opened.
import assert from "node:assert/strict";

const { newPasswordProblem, MIN_PASSWORD_LENGTH, PASSWORD_PROBLEM_MESSAGES } = await import("../lib/password-policy.ts");

const email = "noura.ops@example.test";
const oneTime = "Tmp-8fK2pQ9xLm3v";

assert.equal(newPasswordProblem("short1", oneTime, email), "TOO_SHORT");
assert.equal(newPasswordProblem("x".repeat(201), oneTime, email), "TOO_LONG");
assert.equal(newPasswordProblem(oneTime, oneTime, email), "SAME_AS_ONE_TIME");
assert.equal(newPasswordProblem("Noura.Ops-2026-season", oneTime, email), "CONTAINS_EMAIL");
assert.equal(newPasswordProblem("aaaaaaaaaaaaaaaa", oneTime, email), "TOO_SIMPLE");
assert.equal(newPasswordProblem("abababab1212", oneTime, email), "TOO_SIMPLE");
assert.equal(newPasswordProblem("ليالي البوليفارد 2026", oneTime, email), null, "Arabic passphrases are accepted");
assert.equal(newPasswordProblem("riyadh-season-plan-42", oneTime, email), null);
assert.equal("x".repeat(MIN_PASSWORD_LENGTH).length, 12);
for (const message of Object.values(PASSWORD_PROBLEM_MESSAGES)) assert.ok(message.length > 0);

console.log("invited member password policy passed");
