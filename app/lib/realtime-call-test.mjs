import assert from "node:assert/strict";
import { createRealtimeController } from "./realtime-call.ts";

function harness(overrides = {}) {
  const sent = [];
  const states = [];
  const turns = [];
  const calls = [];
  let ended = 0;
  const controller = createRealtimeController({
    send: (event) => sent.push(event),
    onState: (state) => states.push(state),
    onHeard: () => {},
    onReply: () => {},
    onTurn: (turn) => turns.push(turn),
    onEnd: () => { ended += 1; },
    endGraceMs: 5,
    tools: {
      ask_wanees_engine: async (args) => { calls.push(["ask", args]); return { draft: "ok", facts: { البيانات: [] } }; },
      respond_to_proposal: async (args) => { calls.push(["proposal", args]); return { outcome: "applied" }; },
      end_call: () => { calls.push(["end"]); },
      ...overrides,
    },
  });
  return { controller, sent, states, turns, calls, get ended() { return ended; } };
}

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

{
  const h = harness();
  h.controller.start();
  assert.deepEqual(h.sent[0], { type: "response.create" }, "the call opens with the personal greeting");
  h.controller.handle({ type: "input_audio_buffer.speech_started" });
  h.controller.handle({ type: "conversation.item.input_audio_transcription.completed", transcript: "  وش يناسب العيال؟ " });
  h.controller.handle({ type: "response.output_audio_transcript.done", transcript: "ثواني أشيّك لك" });
  h.controller.handle({ type: "output_audio_buffer.started" });
  h.controller.handle({ type: "output_audio_buffer.stopped" });
  assert.deepEqual(h.turns, [{ role: "visitor", text: "وش يناسب العيال؟" }, { role: "assistant", text: "ثواني أشيّك لك" }]);
  assert.deepEqual(h.states, ["listening", "speaking", "listening"]);

  h.controller.handle({ type: "response.done", response: { output: [{ type: "function_call", name: "ask_wanees_engine", call_id: "c1", arguments: JSON.stringify({ request: "أبي شي للأطفال" }) }] } });
  await tick();
  assert.deepEqual(h.calls[0], ["ask", { request: "أبي شي للأطفال" }]);
  const output = h.sent.find((event) => event.type === "conversation.item.create");
  assert.equal(output.item.type, "function_call_output");
  assert.equal(output.item.call_id, "c1");
  assert.deepEqual(JSON.parse(output.item.output), { draft: "ok", facts: { البيانات: [] } });
  assert.deepEqual(h.sent.at(-1), { type: "response.create" }, "the voice answers after the engine result");
}

{
  const h = harness();
  h.controller.handle({ type: "response.done", response: { output: [{ type: "function_call", name: "respond_to_proposal", call_id: "c2", arguments: "{\"decision\":\"delete_everything\"}" }] } });
  await tick();
  assert.equal(h.calls.length, 0, "an invalid proposal decision never reaches the app");
  assert.equal(JSON.parse(h.sent[0].item.output).error, "invalid_decision");
}

{
  const h = harness();
  h.controller.handle({ type: "response.done", response: { output: [{ type: "function_call", name: "drop_tables", call_id: "c3", arguments: "{}" }] } });
  await tick();
  assert.equal(JSON.parse(h.sent[0].item.output).error, "unknown_tool");
}

{
  const h = harness({ ask_wanees_engine: async () => { throw new Error("offline"); } });
  h.controller.handle({ type: "response.done", response: { output: [{ type: "function_call", name: "ask_wanees_engine", call_id: "c4", arguments: "{\"request\":\"x\"}" }] } });
  await tick();
  assert.equal(JSON.parse(h.sent[0].item.output).error, "tool_failed", "a failed engine call is reported, not invented");
}

{
  const h = harness();
  h.controller.handle({ type: "response.done", response: { output: [{ type: "function_call", name: "end_call", call_id: "c5", arguments: "{}" }] } });
  await tick(20);
  assert.equal(h.ended, 1, "end_call hangs up after the farewell");
  assert.ok(!h.sent.some((event) => event.type === "response.create"), "no new turn after hanging up");
  h.controller.handle({ type: "output_audio_buffer.started" });
  assert.equal(h.ended, 1);
}

{
  // Nudges wait for a pause: queued before start and during a response, spoken after it.
  const h = harness();
  h.controller.notify("«عرض» يبدأ 18:30");
  assert.equal(h.sent.length, 0, "nothing is sent before the call starts");
  h.controller.start();
  assert.deepEqual(h.sent.map((event) => event.type), ["response.create"], "greeting first, nudge waits");
  h.controller.handle({ type: "response.created" });
  h.controller.handle({ type: "response.done", response: { output: [] } });
  assert.equal(h.sent[1].item.role, "system", "nudge spoken right after the greeting");
  assert.match(h.sent[1].item.content[0].text, /<system_nudge>«عرض» يبدأ 18:30/);
  assert.deepEqual(h.sent[2], { type: "response.create" });
  h.controller.notify("ثاني");
  assert.equal(h.sent.length, 3, "a second nudge waits while the first is being spoken");
  h.controller.handle({ type: "response.created" });
  h.controller.handle({ type: "response.done", response: { output: [] } });
  assert.match(h.sent[3].item.content[0].text, /ثاني/);
}

console.log("realtime call controller tests passed");
