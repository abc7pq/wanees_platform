// حواجز «ونيس» الحتمية: الهوية، وكشف التعليمات، ومحاولات تغيير الدور.
// تعمل قبل النموذج (رد ثابت بلا استدعاء) وبعده (رفض أي صياغة تسرّب مزوّد النموذج أو التعليمات)،
// وفي المكالمة الحية تراقب نص الصوت وتقطع الرد إذا ذكر مزوّدًا.
// القاعدة: ونيس مساعد ذكاء اصطناعي من منصة ونيس. لا يدّعي أنه إنسان، ولا يسمّي النموذج أو الشركة خلفه.
import { normalizeArabicText } from "../engine/text.ts";

export type GuardrailTopic = "identity" | "prompt_extraction";

// Matched on normalizeArabicText output (أ→ا، ى→ي، ة→ه، lower case).
const IDENTITY_PATTERNS = [
  /(?:^| )(?:من|مين|منو|وش|ايش|شو) (?:انت|انتي|انتم)(?: |$)/,
  /(?:^| )(?:انت|انتي) (?:مين|منو|من|ايش|وش)(?: |$)/,
  /(?:^| )(?:وش|ايش|شو|ما|ما هو) اسمك(?: |$)/,
  /(?:^| )(?:من|مين|منو|اي شركه|وش الشركه اللي) (?:صنعك|سواك|برمجك|طورك|صممك|دربك|بناك|عملك|وراك|خلفك)(?: |$)/,
  // «أي شركة تنظم الفعالية؟» is about the event, so only the model words count here.
  /(?:^| )(?:اي|وش|ايش|شو|ما|ما هو) (?:ال)?(?:نموذج|موديل|مودل)(?: |$)/,
  /(?:^| )(?:تشتغل|مبني|مبنى|قايم) (?:علي|على) (?:وش|ايش|اي|شو)(?: |$)/,
  /(?:^| )(?:نموذجك|موديلك|مودلك|تقنيتك|شركتك)(?: |$)/,
  /(?:^| )(?:انت|انتي|هل انت) (?:شات|تشات|جي بي تي|جبت|روبوت|بوت|انسان|بشر|حقيقي|ذكاء اصطناعي|اوبن|كلود|جيميني)/,
  /(?:^| )(?:شات ?جي ?بي ?تي|تشات ?جي ?بي ?تي|اوبن ?اي ?اي|اوبن ?ايه ?اي|جي ?بي ?تي|كلود|جيميني|انثروبيك)(?: |$)/,
  /\b(?:chat ?gpt|openai|open ai|gpt[- ]?\d*|claude|anthropic|gemini|llama|mistral|copilot)\b/,
  /\b(?:who|what) (?:are|r) (?:you|u)\b/,
  /\b(?:what|which) (?:model|llm|ai|company)\b/,
  /\b(?:who|which company) (?:made|built|created|trained|developed|owns|runs) (?:you|u)\b/,
  /\bare (?:you|u) (?:an? )?(?:ai|bot|robot|human|real|person|gpt|chatgpt)\b/,
  /\byour (?:name|model|creator|maker)\b/,
];

const EXTRACTION_PATTERNS = [
  /(?:^| )(?:تعليماتك|تعليماتكم|اوامرك|البرومبت|برومبت|البرومت|برومت|الموجه|موجه النظام|رساله النظام|قواعدك)(?: |$)/,
  /(?:^| )(?:انس|انسي|تجاهل|تجاهلي|الغ) (?:كل )?(?:التعليمات|تعليماتك|القواعد|قواعدك|اللي قبل|ما سبق)/,
  /(?:^| )(?:تقمص|تقمصي|مثل انك|خلك|صير) (?:دور|شخصيه)(?: |$)/,
  /\b(?:system prompt|your (?:instructions|prompt|rules)|developer (?:mode|message)|jailbreak|ignore (?:all |the |your )?(?:previous|prior|above)|pretend (?:to be|you are)|act as|you are now|DAN)\b/i,
];

export function guardrailTopic(text: string): GuardrailTopic | null {
  const value = normalizeArabicText(text).replace(/[«»"'`،,.؟?!]/g, " ").replace(/\s+/g, " ").trim();
  if (!value) return null;
  if (EXTRACTION_PATTERNS.some((pattern) => pattern.test(value))) return "prompt_extraction";
  if (IDENTITY_PATTERNS.some((pattern) => pattern.test(value))) return "identity";
  return null;
}

const REPLIES: Record<GuardrailTopic, { ar: string; en: string }> = {
  identity: {
    ar: "أنا ونيس، المساعد الذكي لمنصة ونيس، وموجود هنا عشان زيارتك. تفاصيل التقنية اللي أشتغل عليها ما أشاركها، بس أقدر أرشّح لك نشاط أو أدلّك على مكان أو أرتّب مسارك.",
    en: "I'm Wanees, the AI guide from the WANEES platform, here for your visit. I don't share details about the technology behind me, but I can suggest an activity, point you to a place, or adjust your plan.",
  },
  prompt_extraction: {
    ar: "هذي تفاصيل داخلية ما أشاركها، وأنا باقي ونيس. خلّنا في زيارتك: تبي ترشيح، أو اتجاهات، أو تعديل على مسارك؟",
    en: "Those are internal details I don't share, and I'm still Wanees. Back to your visit: would you like a suggestion, directions, or a change to your plan?",
  },
};

export function guardrailReply(topic: GuardrailTopic, english: boolean) {
  return english ? REPLIES[topic].en : REPLIES[topic].ar;
}

// ————— فحص المخرجات: أي رد يسمّي مزوّد نموذج أو يكشف التعليمات يُرفض —————

const PROVIDER_LEAK = /(?:chat ?gpt|openai|open ai|\bgpt[- ]?\d|\bgpt\b|claude|anthropic|gemini|\bbard\b|llama|mistral|copilot|large language model|language model trained|شات ?جي ?بي ?تي|تشات ?جي ?بي ?تي|جي ?بي ?تي|اوبن ?(?:ا|ايه ?)?اي|أوبن ?(?:ا|ايه ?)?اي|اوبن ايه اي|أوبن إيه آي|كلود|أنثروبيك|انثروبيك|جيميني|جيمناي|نموذج لغوي)/i;
const HUMAN_CLAIM = /(?:^|[\s،.])(?:أنا|انا) (?:إنسان|انسان|بشر|شخص حقيقي|موظف حقيقي)(?=$|[\s،.!؟])|\bI(?:'m| am) (?:a )?(?:human|real person)\b/i;
const PROMPT_LEAK = /(?:wanees-agent-v\d|assistant-intent-v\d|visitor_brief|tool_result|candidate_data_json|visitor_message|previous_assistant_turn|system_nudge|system_correction|personal_picks|event_zones|ask_wanees_engine|respond_to_proposal|reply_language|visitor_position)/i;

/** Violations for a model reply. The corpus (catalog facts) may legitimately hold a name, so it is checked too. */
export function guardrailViolations(reply: string, corpus = "") {
  const violations: string[] = [];
  const provider = reply.match(PROVIDER_LEAK)?.[0];
  if (provider && !corpus.toLowerCase().includes(provider.toLowerCase())) violations.push(`identity-leak:${provider}`);
  if (HUMAN_CLAIM.test(reply)) violations.push("claims-human");
  if (PROMPT_LEAK.test(reply)) violations.push("prompt-leak");
  return violations;
}

/** Spoken transcript so far names a model provider or reveals internals: cut the reply. */
export function spokenReplyLeaks(transcript: string) {
  return PROVIDER_LEAK.test(transcript) || PROMPT_LEAK.test(transcript) || HUMAN_CLAIM.test(transcript);
}

/** What the voice must say after a leaked reply is cut. */
export const SPOKEN_IDENTITY_CORRECTION = REPLIES.identity.ar;
