import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

/**
 * Item 5: the one structured log record for every assistant / LLM / tool turn.
 *
 * Rules:
 * - Owners (AI4 reason codes, AI5 cost, P8 prompt versions, R5/F3 failures, O7 alerts)
 *   import this schema. Nobody adds ad-hoc fields; extend here with a version bump.
 * - No visitor content. Message text, transcripts, prompts and model output never enter
 *   a record. Use `contentHash()` when correlation is needed.
 * - `trace_id` equals the HTTP `requestId` (x-request-id) so it joins `wanees.http` logs.
 */
export const AGENT_LOG_SCHEMA_VERSION = "agent-log-v1" as const;

const id = z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/);
const sha256 = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const nonNegInt = z.number().int().nonnegative();

export const agentLogChannelSchema = z.enum(["text", "voice", "call", "nudge", "push", "system"]);
export const agentLogPathSchema = z.enum(["primary", "fallback", "degraded", "rule_based", "human"]);
export const agentLogStatusSchema = z.enum(["ok", "rejected", "error", "timeout", "budget_exceeded", "conflict"]);

/** Reason codes are an allow-list so alerts (O7) can key on them. Add new ones here. */
export const agentLogReasonCodeSchema = z.enum([
  "none",
  "grounding_number",
  "grounding_name",
  "grounding_time",
  "invalid_output",
  "injection_suspected",
  "stale_revision",
  "missing_proposal",
  "proposal_not_found",
  "rate_limited",
  "llm_budget",
  "provider_error",
  "provider_timeout",
  "tool_error",
  "persist_failed",
  "analytics_failed",
]);

export const agentLogRecordSchema = z
  .object({
    event: z.literal("wanees.agent"),
    schema_version: z.literal(AGENT_LOG_SCHEMA_VERSION),
    ts: z.iso.datetime(),
    trace_id: id,
    span_id: id,
    parent_span_id: id.optional(),
    turn_id: id.optional(),
    channel: agentLogChannelSchema,
    path: agentLogPathSchema,
    step: z.string().regex(/^[a-z][a-z0-9_.]{0,63}$/),
    model: z.string().max(80).optional(),
    prompt_version: z.string().regex(/^[a-z0-9-]{1,64}$/).optional(),
    tool: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).optional(),
    latency_ms: nonNegInt,
    tokens_in: nonNegInt.optional(),
    tokens_out: nonNegInt.optional(),
    cost_usd: z.number().nonnegative().optional(),
    confidence: z.number().min(0).max(1).optional(),
    status: agentLogStatusSchema,
    reason_code: agentLogReasonCodeSchema,
    input_hash: sha256.optional(),
    output_hash: sha256.optional(),
  })
  .strict(); // unknown keys (message, transcript, prompt, ...) are rejected, not stripped

export type AgentLogRecord = z.infer<typeof agentLogRecordSchema>;
export type AgentLogInput = Omit<AgentLogRecord, "event" | "schema_version" | "ts" | "span_id"> & {
  span_id?: string;
  ts?: string;
};

/** Field names that must never appear, even nested, even if the schema is later loosened. */
const FORBIDDEN_KEYS = /^(message|messages|transcript|prompt|content|text|reply|output|input|raw|body)$/i;

function findForbiddenKey(value: unknown, path = ""): string | null {
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.test(key)) return `${path}${key}`;
    const nested = findForbiddenKey(child, `${path}${key}.`);
    if (nested) return nested;
  }
  return null;
}

export function contentHash(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function newSpanId() {
  return randomUUID();
}

export type AgentLogResult =
  | { ok: true; record: AgentLogRecord }
  | { ok: false; error: string };

/** Validates without writing. Use in tests and anywhere a record is built ahead of time. */
export function buildAgentLog(input: AgentLogInput): AgentLogResult {
  const forbidden = findForbiddenKey(input);
  if (forbidden) return { ok: false, error: `forbidden_field:${forbidden}` };
  const parsed = agentLogRecordSchema.safeParse({
    event: "wanees.agent",
    schema_version: AGENT_LOG_SCHEMA_VERSION,
    ts: input.ts ?? new Date().toISOString(),
    span_id: input.span_id ?? newSpanId(),
    ...input,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}:${i.code}`).join(",") };
  }
  return { ok: true, record: parsed.data };
}

type Sink = (line: string) => void;
let sink: Sink = (line) => console.info(line);

/** Test hook only. */
export function setAgentLogSink(next: Sink | null) {
  sink = next ?? ((line) => console.info(line));
}

/**
 * Emits one record. Never throws into the caller's request path: an invalid record is
 * replaced by a minimal `wanees.agent.invalid` line (no payload) so the bug is visible.
 */
export function logAgent(input: AgentLogInput): AgentLogResult {
  const result = buildAgentLog(input);
  try {
    if (result.ok) {
      sink(JSON.stringify(result.record));
    } else {
      sink(JSON.stringify({
        event: "wanees.agent.invalid",
        schema_version: AGENT_LOG_SCHEMA_VERSION,
        trace_id: typeof input.trace_id === "string" && id.safeParse(input.trace_id).success ? input.trace_id : undefined,
        error: result.error,
      }));
    }
  } catch {
    // logging must never break a visitor request
  }
  return result;
}
