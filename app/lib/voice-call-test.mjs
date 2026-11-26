import assert from "node:assert/strict";
import { createVoiceCall } from "./voice-call.ts";

function setup(requestReply) {
  const microphones = [];
  const spoken = [];
  const states = [];
  const requests = [];
  const visibleReplies = [];
  let reviews = 0;
  const call = createVoiceCall({
    createRecognition() {
      const mic = { start() { this.started = true; }, abort() { this.aborted = true; } };
      microphones.push(mic);
      return mic;
    },
    requestReply(text) { requests.push(text); return requestReply(text); },
    speak(text, done, failed) {
      const speech = { text, done, failed, cancelled: false };
      spoken.push(speech);
      return () => { speech.cancelled = true; };
    },
    onHeard() {},
    onState(state) { states.push(state); },
    onReply(text) { visibleReplies.push(text); },
    onReview() { reviews += 1; },
  });
  return { call, requests, microphones, spoken, states, visibleReplies, reviews: () => reviews };
}

function recognize(mic, text, isFinal = true) {
  mic.onresult({ results: [{ isFinal, 0: { transcript: text } }] });
}

const multi = setup(async (text) => ({ text: `رد على ${text}` }));
multi.call.start();
assert.equal(multi.microphones[0].lang, "ar-SA");
recognize(multi.microphones[0], "هلا", false);
assert.equal(multi.requests.length, 0);
recognize(multi.microphones[0], "هلا ونيس");
assert.equal(multi.requests.length, 0, "wait for the mic to close before requesting a reply");
multi.microphones[0].onend();
await Promise.resolve();
assert.deepEqual(multi.requests, ["هلا ونيس"]);
assert.equal(multi.microphones.length, 1, "microphone must stay closed during playback");
assert.equal(multi.visibleReplies[0], "رد على هلا ونيس");
multi.spoken[0].done();
assert.equal(multi.microphones.length, 2, "resume listening automatically after the reply");
recognize(multi.microphones[1], "كيف الحال؟");
multi.microphones[1].onend();
await Promise.resolve();
assert.deepEqual(multi.requests, ["هلا ونيس", "كيف الحال؟"]);
multi.call.stop();
assert.equal(multi.spoken[1].cancelled, true);
multi.spoken[1].done();
assert.equal(multi.microphones.length, 2, "late playback callbacks must not reopen the mic");

let finishReply;
const pending = setup(() => new Promise((resolve) => { finishReply = resolve; }));
pending.call.start();
recognize(pending.microphones[0], "سولف معي");
pending.microphones[0].onend();
pending.call.stop();
finishReply({ text: "أبشر" });
await Promise.resolve();
assert.equal(pending.spoken.length, 0, "a response arriving after hangup must not play");

const review = setup(async () => ({ text: "راجع الاقتراح", needsReview: true }));
review.call.start();
recognize(review.microphones[0], "قصر الجولة");
review.microphones[0].onend();
await Promise.resolve();
review.spoken[0].done();
assert.equal(review.reviews(), 1);
assert.equal(review.microphones.length, 1, "proposal review requires a visitor decision outside the call");

const silent = setup(async () => ({ text: "رد" }));
silent.call.start();
silent.microphones[0].onerror({ error: "no-speech" });
assert.equal(silent.states.at(-1), "paused");
assert.equal(silent.microphones[0].aborted, true);
assert.equal(silent.requests.length, 0);

console.log("voice call lifecycle: multi-turn, hangup, silence, and review passed");
