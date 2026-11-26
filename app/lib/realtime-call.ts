// مكالمة «ونيس» الحية في المتصفح: صوت ثنائي الاتجاه عبر WebRTC مع OpenAI Realtime.
// النموذج الصوتي يتكلم فقط؛ الحقائق والتعديلات تأتي من أدوات تستدعي محرك WANEES الحتمي.
// لا يُخزَّن صوت ولا نص كامل في المتصفح.
import type { VoiceCallState } from "./voice-call.ts";
import { SPOKEN_IDENTITY_CORRECTION, spokenReplyLeaks } from "./agent-guardrails.ts";

export type RealtimeToolHandlers = {
  ask_wanees_engine: (args: { request: string }) => Promise<unknown>;
  respond_to_proposal: (args: { decision: "accept" | "keep_current" }) => Promise<unknown>;
  end_call: () => Promise<unknown> | unknown;
};

export type RealtimeControllerOptions = {
  send: (event: Record<string, unknown>) => void;
  tools: RealtimeToolHandlers;
  onState: (state: VoiceCallState) => void;
  onHeard: (text: string) => void;
  onReply: (text: string) => void;
  onTurn?: (turn: { role: "visitor" | "assistant"; text: string }) => void;
  onEnd: () => void;
  /** الحارس قطع ردًا صوتيًا (لا يُمرَّر نص الرد). */
  onGuardrail?: (kind: "identity-leak") => void;
  /** مهلة الإنهاء بعد طلب end_call إن لم يُسمع وداع (ملّي ثانية). */
  endGraceMs?: number;
};

type FunctionCall = { type: "function_call"; name: string; call_id: string; arguments?: string };

function parseArguments(raw: string | undefined) {
  try {
    const value = JSON.parse(raw || "{}");
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

// يحوّل أحداث Realtime إلى حالة المكالمة ويشغّل الأدوات. منفصل عن WebRTC ليُختبر وحده.
export function createRealtimeController(options: RealtimeControllerOptions) {
  let replyText = "";
  let speaking = false;
  let endRequested = false;
  let ended = false;
  let endTimer: ReturnType<typeof setTimeout> | undefined;
  // Nudges wait for a pause: never mid-response (the API rejects a second response) or before start.
  let started = false;
  let responding = false;
  const pendingNudges: string[] = [];
  let guardTripped = false;
  let correctionPending = false;
  let leakedItemId: string | null = null;
  const flushNudge = () => {
    if (!started || responding || ended || endRequested || !pendingNudges.length) return;
    responding = true;
    nudgeEvents(pendingNudges.shift()!).forEach((event) => options.send(event));
  };

  const finish = () => {
    if (ended) return;
    ended = true;
    clearTimeout(endTimer);
    options.onEnd();
  };

  async function runTool(call: FunctionCall) {
    const args = parseArguments(call.arguments);
    try {
      if (call.name === "ask_wanees_engine") {
        const request = typeof args.request === "string" ? args.request.trim().slice(0, 500) : "";
        if (!request) return { error: "empty_request" };
        return await options.tools.ask_wanees_engine({ request });
      }
      if (call.name === "respond_to_proposal") {
        const decision = args.decision === "accept" ? "accept" : args.decision === "keep_current" ? "keep_current" : null;
        if (!decision) return { error: "invalid_decision" };
        return await options.tools.respond_to_proposal({ decision });
      }
      if (call.name === "end_call") {
        endRequested = true;
        await options.tools.end_call();
        return { ok: true };
      }
      return { error: "unknown_tool" };
    } catch {
      return { error: "tool_failed", note: "تعذر الوصول للنظام الآن؛ اعتذر باختصار واقترح المحاولة مرة ثانية أو الكتابة." };
    }
  }

  async function handleFunctionCalls(calls: FunctionCall[]) {
    options.onState("thinking");
    for (const call of calls) {
      const output = await runTool(call);
      if (ended) return;
      options.send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: call.call_id, output: JSON.stringify(output ?? null) } });
    }
    if (endRequested) {
      endTimer = setTimeout(finish, speaking ? 8_000 : options.endGraceMs ?? 1_500);
      return;
    }
    responding = true;
    options.send({ type: "response.create" });
  }

  function handle(event: Record<string, any>) {
    if (ended || !event || typeof event.type !== "string") return;
    switch (event.type) {
      case "input_audio_buffer.speech_started":
        options.onState("listening");
        break;
      case "input_audio_buffer.speech_stopped":
        options.onState("thinking");
        break;
      case "conversation.item.input_audio_transcription.completed": {
        const text = String(event.transcript ?? "").trim().slice(0, 500);
        if (text) {
          options.onHeard(text);
          options.onTurn?.({ role: "visitor", text });
        }
        break;
      }
      case "response.created":
        responding = true;
        replyText = "";
        guardTripped = false;
        break;
      case "response.output_audio_transcript.delta":
        if (guardTripped) break;
        replyText += String(event.delta ?? "");
        if (spokenReplyLeaks(replyText)) {
          // The voice started naming a model provider or its internals: stop the audio now, drop the
          // item from the conversation, and say the fixed identity line once this response is done.
          guardTripped = true;
          leakedItemId = typeof event.item_id === "string" ? event.item_id : null;
          correctionPending = true;
          options.send({ type: "response.cancel" });
          options.send({ type: "output_audio_buffer.clear" });
          options.onReply("");
          options.onGuardrail?.("identity-leak");
          break;
        }
        options.onReply(replyText.trim());
        break;
      case "response.output_audio_transcript.done": {
        const text = guardTripped ? "" : String(event.transcript ?? replyText).trim();
        replyText = "";
        if (text) {
          options.onReply(text);
          options.onTurn?.({ role: "assistant", text });
        }
        break;
      }
      case "output_audio_buffer.started":
        speaking = true;
        options.onState("speaking");
        break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        speaking = false;
        if (endRequested) {
          clearTimeout(endTimer);
          endTimer = setTimeout(finish, 300);
        } else {
          options.onState("listening");
        }
        break;
      case "response.done": {
        responding = false;
        if (correctionPending) {
          // Tool calls from a cut response are dropped: the visitor never heard what led to them.
          correctionPending = false;
          if (leakedItemId) options.send({ type: "conversation.item.delete", item_id: leakedItemId });
          leakedItemId = null;
          responding = true;
          correctionEvents().forEach((item) => options.send(item));
          break;
        }
        const output = Array.isArray(event.response?.output) ? event.response.output : [];
        const calls = output.filter((item: any) => item?.type === "function_call" && typeof item.call_id === "string") as FunctionCall[];
        if (calls.length) void handleFunctionCalls(calls);
        else {
          if (!speaking && !endRequested) options.onState("listening");
          flushNudge();
        }
        break;
      }
      default:
        break;
    }
  }

  return {
    handle,
    start() { started = true; responding = true; options.send({ type: "response.create" }); },
    /** يقول تنبيهًا استباقيًا عند أول سكتة (بعد الرد الجاري). */
    notify(text: string) { pendingNudges.push(text); flushNudge(); },
    stop() { finish(); },
    get ended() { return ended; },
  };
}

export type RealtimeCallHandle = {
  stop: () => void;
  setMuted: (muted: boolean) => void;
  /** تنبيه استباقي من المحرك: يُقال للزائر بصوت ونيس أثناء المكالمة. */
  notify: (text: string) => void;
};

/** بعد قطع رد سرّب مزوّد النموذج: الصوت يقول سطر الهوية الثابت فقط. */
export function correctionEvents() {
  return [
    { type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text: `<system_correction>${SPOKEN_IDENTITY_CORRECTION}</system_correction>` }] } },
    { type: "response.create", response: { instructions: `قل للزائر هذا النص فقط بصوتك الطبيعي ثم اسكت واسمع: «${SPOKEN_IDENTITY_CORRECTION}»`, tool_choice: "none" } },
  ];
}

/** حدث نظام يطلب من الصوت أن ينقل تنبيهًا حتميًا كما هو، ثم يسمع الزائر. */
export function nudgeEvents(text: string) {
  return [
    { type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text: `<system_nudge>${text.slice(0, 400)}</system_nudge>` }] } },
    { type: "response.create" },
  ];
}

type StartOptions = Omit<RealtimeControllerOptions, "send" | "onEnd"> & {
  clientSecret: string;
  onEnd: (reason: "ended" | "error") => void;
};

// يفتح اتصال WebRTC: ميكروفون الزائر ← نموذج الصوت → سماعة الزائر، وقناة بيانات للأحداث والأدوات.
export async function startRealtimeCall(options: StartOptions): Promise<RealtimeCallHandle> {
  const pc = new RTCPeerConnection();
  const audio = document.createElement("audio");
  audio.autoplay = true;
  let mic: MediaStream | null = null;
  let closed = false;
  let controller: ReturnType<typeof createRealtimeController> | null = null;

  const close = (reason: "ended" | "error") => {
    if (closed) return;
    closed = true;
    try { channel.close(); } catch { /* already closed */ }
    try { pc.close(); } catch { /* already closed */ }
    mic?.getTracks().forEach((track) => track.stop());
    audio.srcObject = null;
    options.onEnd(reason);
  };

  pc.ontrack = (event) => { audio.srcObject = event.streams[0]; };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "disconnected") close("error");
  };
  const channel = pc.createDataChannel("oai-events");
  const send = (event: Record<string, unknown>) => {
    if (channel.readyState === "open") channel.send(JSON.stringify(event));
  };
  controller = createRealtimeController({ ...options, send, onEnd: () => close("ended") });
  channel.onmessage = (message) => {
    try { controller?.handle(JSON.parse(String(message.data))); } catch { /* ignore malformed event */ }
  };
  channel.onopen = () => {
    options.onState("speaking");
    controller?.start();
  };

  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    for (const track of mic.getAudioTracks()) pc.addTrack(track, mic);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const response = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      body: offer.sdp,
      headers: { Authorization: `Bearer ${options.clientSecret}`, "Content-Type": "application/sdp" },
    });
    if (!response.ok) throw new Error(`realtime_sdp_${response.status}`);
    await pc.setRemoteDescription({ type: "answer", sdp: await response.text() });
  } catch (error) {
    close("error");
    throw error;
  }

  return {
    stop: () => close("ended"),
    setMuted: (muted) => mic?.getAudioTracks().forEach((track) => { track.enabled = !muted; }),
    notify: (text) => { if (!closed) controller?.notify(text); },
  };
}
