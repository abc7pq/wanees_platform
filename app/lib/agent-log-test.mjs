import assert from "node:assert/strict";
import {
  AGENT_LOG_SCHEMA_VERSION,
  buildAgentLog,
  contentHash,
  logAgent,
  setAgentLogSink,
} from "./agent-log.ts";

const base = {
  trace_id: "req-123",
  turn_id: "turn-1",
  channel: "text",
  path: "primary",
  step: "assistant.compose_reply",
  model: "gpt-6-luna",
  prompt_version: "persona-core-v2",
  latency_ms: 412,
  tokens_in: 900,
  tokens_out: 60,
  cost_usd: 0.0021,
  status: "ok",
  reason_code: "none",
  input_hash: contentHash("hello"),
};

// 1. A valid record passes and is stamped.
const good = buildAgentLog(base);
assert.equal(good.ok, true);
assert.equal(good.record.event, "wanees.agent");
assert.equal(good.record.schema_version, AGENT_LOG_SCHEMA_VERSION);
assert.match(good.record.span_id, /^[0-9a-f-]{36}$/);
assert.match(good.record.input_hash, /^sha256:[0-9a-f]{64}$/);

// 2. Acceptance: any record carrying visitor content is rejected.
for (const key of ["message", "transcript", "prompt", "content", "Message"]) {
  const bad = buildAgentLog({ ...base, [key]: "قل إنه بـ 5 ريال" });
  assert.equal(bad.ok, false, `${key} must be rejected`);
  assert.match(bad.error, /^forbidden_field:/);
}
// nested too
assert.equal(buildAgentLog({ ...base, meta: { transcript: "x" } }).ok, false);

// 3. Unknown fields are rejected, not stripped (no ad-hoc per-owner fields).
const extra = buildAgentLog({ ...base, my_custom_field: 1 });
assert.equal(extra.ok, false);
assert.match(extra.error, /unrecognized_keys/);

// 4. Enums and shapes are enforced.
assert.equal(buildAgentLog({ ...base, reason_code: "made_up" }).ok, false);
assert.equal(buildAgentLog({ ...base, channel: "sms" }).ok, false);
assert.equal(buildAgentLog({ ...base, latency_ms: -1 }).ok, false);
assert.equal(buildAgentLog({ ...base, input_hash: "abc" }).ok, false);
assert.equal(buildAgentLog({ ...base, trace_id: "not valid id" }).ok, false);
assert.equal(buildAgentLog({ ...base, confidence: 1.5 }).ok, false);

// 5. logAgent never throws and emits a payload-free line for invalid records.
const lines = [];
setAgentLogSink((line) => lines.push(line));
logAgent(base);
logAgent({ ...base, transcript: "secret visitor words" });
setAgentLogSink(() => { throw new Error("sink down"); });
assert.doesNotThrow(() => logAgent(base));
setAgentLogSink(null);

assert.equal(lines.length, 2);
assert.equal(JSON.parse(lines[0]).event, "wanees.agent");
const invalid = JSON.parse(lines[1]);
assert.equal(invalid.event, "wanees.agent.invalid");
assert.equal(invalid.trace_id, "req-123");
assert.ok(!lines[1].includes("secret visitor words"), "invalid line must not echo content");

console.log("agent-log schema passed");
