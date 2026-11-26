export type VoiceCallState = "idle" | "listening" | "thinking" | "speaking" | "paused" | "error";
export type VoiceReply = { text: string; needsReview?: boolean };

export type VoiceRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
};

type VoiceCallOptions = {
  createRecognition: () => VoiceRecognition;
  requestReply: (text: string) => Promise<VoiceReply | null>;
  speak: (text: string, done: () => void, failed: () => void) => (() => void);
  onState: (state: VoiceCallState) => void;
  onHeard: (text: string) => void;
  onReply: (text: string) => void;
  onReview: () => void;
};

export function createVoiceCall(options: VoiceCallOptions) {
  let active = false;
  let recognition: VoiceRecognition | null = null;
  let cancelSpeech: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function detachRecognition() {
    const listening = recognition;
    recognition = null;
    if (listening) {
      listening.onresult = null;
      listening.onerror = null;
      listening.onend = null;
    }
    return listening;
  }

  function end(state: VoiceCallState = "idle") {
    active = false;
    clearTimeout(timer);
    const listening = detachRecognition();
    try { listening?.abort(); } catch { /* capture may already be closed */ }
    cancelSpeech?.();
    cancelSpeech = null;
    options.onState(state);
  }

  async function answer(text: string) {
    options.onState("thinking");
    let reply: VoiceReply | null;
    try {
      reply = await options.requestReply(text);
    } catch {
      if (active) end("error");
      return;
    }
    if (!active) return;
    if (!reply?.text) return end("paused");

    options.onReply(reply.text);
    options.onState("speaking");
    const nextTurn = () => {
      if (!active) return;
      clearTimeout(timer);
      cancelSpeech = null;
      if (reply.needsReview) {
        end();
        options.onReview();
      } else {
        listen();
      }
    };
    const speechFailed = () => {
      if (active) end("error");
    };
    timer = setTimeout(speechFailed, 55_000);
    try {
      cancelSpeech = options.speak(reply.text, nextTurn, speechFailed);
    } catch {
      speechFailed();
    }
  }

  function listen() {
    let heard = "";
    try {
      options.onState("listening");
      const current = options.createRecognition();
      recognition = current;
      current.lang = "ar-SA";
      current.continuous = false;
      current.interimResults = true;
      current.onresult = ({ results }) => {
        if (!active || recognition !== current) return;
        const segments = Array.from(results);
        heard = segments.filter((segment) => segment.isFinal)
          .map((segment) => segment[0]?.transcript ?? "").join(" ").trim().slice(0, 500);
        options.onHeard(segments.map((segment) => segment[0]?.transcript ?? "").join(" ").trim().slice(0, 500));
      };
      current.onend = () => {
        if (!active || recognition !== current) return;
        clearTimeout(timer);
        detachRecognition();
        if (heard) void answer(heard);
        else end("paused");
      };
      current.onerror = ({ error }) => {
        if (active && recognition === current) end(error === "no-speech" ? "paused" : "error");
      };
      timer = setTimeout(() => end("paused"), 30_000);
      current.start();
    } catch {
      end("error");
    }
  }

  return {
    start() {
      if (active) return;
      active = true;
      listen();
    },
    stop() { end(); },
  };
}
