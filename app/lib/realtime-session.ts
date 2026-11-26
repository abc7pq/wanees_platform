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
    description: "المصدر الوحيد لحقائق الفعالية وأي تعديل على مسار الزائر: الأنشطة والأسعار والمواعيد والأماكن والاتجاهات والزحام وحالة المسار، وبناء المسار أو الإضافة أو الحذف أو التبديل أو التقصير، والبلاغات وطلب موظف.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["request"],
      properties: {
        request: { type: "string", description: "طلب الزائر بعربية واضحة وكاملة كما قصده، مثل «أبي نشاط أهدى قريب يناسب الأطفال»." },
      },
    },
  },
  {
    type: "function",
    name: "respond_to_proposal",
    description: "ينفّذ قرار الزائر على اقتراح تعديل المسار المعروض. لا تستدعها إلا بعد جواب صريح من الزائر في هذه المكالمة.",
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
    description: "ينهي المكالمة بعد أن تودّع الزائر.",
    parameters: { type: "object", additionalProperties: false, properties: {} },
  },
] as const;

export function realtimeAvailable() {
  return Boolean(process.env.OPENAI_API_KEY?.trim()) && isFeatureEnabled(FEATURE_FLAGS.llmAdapter);
}

export function realtimeModel() {
  return process.env.WANEES_OPENAI_REALTIME_MODEL?.trim() || "gpt-realtime-2";
}

export function buildCallInstructions(input: { visitorBrief: string; suggestions: string[]; greeting: string }) {
  return [
    personaInstructions("call"),
    "",
    "<visitor_brief>",
    input.visitorBrief,
    "</visitor_brief>",
    input.suggestions.length ? `<personal_picks>\nترشيحات محسوبة من الكتالوج لهذا الزائر (استخدمها عند السؤال العام «وش تنصحني»، وللتفاصيل استدعِ الأداة):\n${input.suggestions.join("\n")}\n</personal_picks>` : "",
    "",
    `أول ما تبدأ المكالمة قل بالضبط تقريبًا: «${input.greeting}» ثم اسكت واسمع.`,
  ].filter((line) => line !== null).join("\n");
}

export function callGreeting(input: { hasPlan: boolean; nextName?: string; withKids: boolean; returning?: boolean }) {
  const hello = input.returning ? "هلا والله، حيّاك من جديد، معك ونيس." : "هلا والله، معك ونيس.";
  if (input.hasPlan && input.nextName) return `${hello} محطتك الجاية «${input.nextName}»، تبي نمشي عليها ولا عندك شي ثاني في بالك؟`;
  if (input.withKids) return `${hello} وش تحبون تسوون أنت والعيال؟`;
  return `${hello} وش جوّك اليوم؟`;
}

export type RealtimeSecret = { clientSecret: string; expiresAt: number; model: string };

export async function createRealtimeClientSecret(instructions: string): Promise<RealtimeSecret | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key || !realtimeAvailable()) return null;
  const model = realtimeModel();
  try {
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8_000),
      body: JSON.stringify({
        expires_after: { anchor: "created_at", seconds: 120 },
        session: {
          type: "realtime",
          model,
          instructions,
          output_modalities: ["audio"],
          audio: {
            input: {
              transcription: { model: process.env.WANEES_OPENAI_TRANSCRIBE_MODEL?.trim() || "gpt-4o-mini-transcribe", language: "ar" },
              turn_detection: { type: "semantic_vad", eagerness: "medium" },
              noise_reduction: { type: "far_field" },
            },
            output: { voice: process.env.WANEES_OPENAI_REALTIME_VOICE?.trim() || "marin" },
          },
          tools: REALTIME_TOOLS,
          tool_choice: "auto",
          max_output_tokens: 700,
        },
      }),
    });
    if (!response.ok) return null;
    const data = await response.json() as { value?: unknown; expires_at?: unknown };
    if (typeof data.value !== "string" || !data.value) return null;
    return { clientSecret: data.value, expiresAt: Number(data.expires_at) || 0, model };
  } catch {
    // لا نسجل محتوى الطلب ولا المفاتيح؛ المتصفح يرجع للمكالمة المحلية.
    return null;
  }
}
