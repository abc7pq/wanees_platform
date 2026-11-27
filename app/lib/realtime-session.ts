// جلسة مكالمة «ونيس» الصوتية الحية (OpenAI Realtime عبر WebRTC).
// المفتاح الدائم يبقى في الخادم؛ المتصفح يستلم مفتاحًا مؤقتًا قصير العمر فقط.
// النموذج الصوتي لا يملك حقائق الفعالية: كل حقيقة أو تعديل يمر عبر أداة ask_wanees_engine
// التي تستدعي نفس المحرك الحتمي لنقطة /assistant.
import { personaInstructions } from "./agent-persona.ts";
import { FEATURE_FLAGS, isFeatureEnabled } from "./feature-flags.ts";

export const REALTIME_TOOLS = [
  {
    type: "function",
    name: "ask_wanees_engine",
    description: "المصدر الوحيد لحقائق الفعالية وأي تعديل على مسار الزائر. استدعها لأي سؤال عن نشاط أو سعر أو موعد أو مدة أو مكان أو اتجاه أو زحام أو حالة المسار أو العروض الجاية أو البدائل، ولأي طلب بناء مسار أو إضافة أو حذف أو تبديل أو تقصير، ولأي بلاغ أو طلب موظف. لا تستدعها لسؤال عن هويتك أو للسوالف العامة. ترجع حقائق مختصرة وأحيانًا اقتراحًا ينتظر موافقة الزائر.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["request"],
      properties: {
        request: { type: "string", description: "طلب الزائر بعربية واضحة وكاملة كما قصده، مع كل تفصيل قاله يؤثر على النتيجة (مين معه، العمر، الميزانية، الوقت، اسم المحطة). مثل «أبي نشاط أهدى قريب لطفل عمره ست سنوات» أو «بدّل المحطة الجاية بشي أرخص»." },
      },
    },
  },
  {
    type: "function",
    name: "respond_to_proposal",
    description: "ينفّذ قرار الزائر على اقتراح تعديل المسار المعروض الآن. لا تستدعها إلا بعد جواب صريح من الزائر في هذه المكالمة: accept لموافقة واضحة («إيه»، «اعتمده»، «تمام»)، وkeep_current للرفض أو التردد.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["decision"],
      properties: { decision: { type: "string", enum: ["accept", "keep_current"] } },
    },
  },
  {
    type: "function",
    name: "end_call",
    description: "ينهي المكالمة. استدعها فقط بعد أن تودّع الزائر بجملة قصيرة، لما يودّع هو أو يطلب الإنهاء.",
    parameters: { type: "object", additionalProperties: false, properties: {} },
  },
] as const;

export const REALTIME_DEFAULT_MODEL = "gpt-realtime-2.1";
export const REALTIME_DEFAULT_VOICE = "cedar";
export const REALTIME_DEFAULT_REASONING = "low";
export const REALTIME_DEFAULT_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";
const REALTIME_REASONING_EFFORTS = new Set(["minimal", "low", "medium", "high"]);

export function realtimeAvailable() {
  return Boolean(process.env.OPENAI_API_KEY?.trim()) && isFeatureEnabled(FEATURE_FLAGS.llmAdapter);
}

export function realtimeModel() {
  return process.env.WANEES_OPENAI_REALTIME_MODEL?.trim() || REALTIME_DEFAULT_MODEL;
}

/** The spoken voice. ونيس is a male Saudi name, so the default is OpenAI's warm male voice `cedar`. */
export function realtimeVoice() {
  return process.env.WANEES_OPENAI_REALTIME_VOICE?.trim() || REALTIME_DEFAULT_VOICE;
}

/** OpenAI recommends `low` for production voice agents; facts come from the engine, so no deeper effort is needed. */
export function realtimeReasoningEffort() {
  const value = process.env.WANEES_OPENAI_REALTIME_REASONING?.trim().toLowerCase() || REALTIME_DEFAULT_REASONING;
  return REALTIME_REASONING_EFFORTS.has(value) ? value : REALTIME_DEFAULT_REASONING;
}

/** Visitor-speech transcription (on-screen only). Empty language = auto-detect, so other languages transcribe too. */
export function realtimeTranscription() {
  const language = process.env.WANEES_OPENAI_TRANSCRIBE_LANGUAGE?.trim();
  return { model: process.env.WANEES_OPENAI_TRANSCRIBE_MODEL?.trim() || REALTIME_DEFAULT_TRANSCRIBE_MODEL, ...(language ? { language } : {}) };
}

export function buildCallInstructions(input: { visitorBrief: string; suggestions: string[]; greeting: string; zones?: string[] }) {
  return [
    personaInstructions("call"),
    "",
    "<visitor_brief>",
    input.visitorBrief,
    "</visitor_brief>",
    input.zones?.length ? `<event_zones>\nمناطق الفعالية كما تُنطق (للفهم والنطق فقط؛ الاتجاهات من الأداة): ${input.zones.join("، ")}\n</event_zones>` : "",
    input.suggestions.length ? `<personal_picks>\nترشيحات محسوبة من الكتالوج لهذا الزائر (استخدمها عند السؤال العام «وش تنصحني»، وللتفاصيل والبدائل استدعِ الأداة):\n${input.suggestions.join("\n")}\n</personal_picks>` : "",
    "",
    `أول ما تبدأ المكالمة قل بالضبط تقريبًا: «${input.greeting}» ثم اسكت واسمع.`,
  ].filter((line) => line !== "").join("\n");
}

export function callGreeting(input: { hasPlan: boolean; nextName?: string; withKids: boolean; returning?: boolean }) {
  const hello = input.returning ? "هلا والله، حيّاك من جديد، معك ونيس." : "هلا والله وغلا، معك ونيس.";
  if (input.hasPlan && input.nextName) return `${hello} محطتك الجاية «${input.nextName}»، تبي نمشي عليها ولا عندك شي ثاني في بالك؟`;
  if (input.withKids) return `${hello} وش تحبون تسوون أنت والعيال الليلة؟`;
  return `${hello} وش جوّك الليلة؟`;
}

export type RealtimeSecret = { clientSecret: string; expiresAt: number; model: string };

/** The exact session the browser will run; exported so tests can check it without a network. */
export function realtimeSessionConfig(instructions: string) {
  return {
    type: "realtime",
    model: realtimeModel(),
    instructions,
    reasoning: { effort: realtimeReasoningEffort() },
    output_modalities: ["audio"],
    audio: {
      input: {
        transcription: realtimeTranscription(),
        // Semantic VAD waits for the end of a thought, not just silence: fewer cut-offs in a noisy venue.
        turn_detection: { type: "semantic_vad", eagerness: "medium", create_response: true, interrupt_response: true },
        noise_reduction: { type: "far_field" },
      },
      output: { voice: realtimeVoice() },
    },
    tools: REALTIME_TOOLS,
    tool_choice: "auto",
    max_output_tokens: 700,
  };
}

export async function createRealtimeClientSecret(instructions: string): Promise<RealtimeSecret | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key || !realtimeAvailable()) return null;
  const session = realtimeSessionConfig(instructions);
  try {
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8_000),
      body: JSON.stringify({ expires_after: { anchor: "created_at", seconds: 120 }, session }),
    });
    if (!response.ok) return null;
    const data = await response.json() as { value?: unknown; expires_at?: unknown };
    if (typeof data.value !== "string" || !data.value) return null;
    return { clientSecret: data.value, expiresAt: Number(data.expires_at) || 0, model: session.model };
  } catch {
    // لا نسجل محتوى الطلب ولا المفاتيح؛ المتصفح يرجع للمكالمة المحلية.
    return null;
  }
}
