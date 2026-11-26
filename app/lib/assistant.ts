import { parseCommand, type ChatAction } from "./llm.ts";
import { partySize, pickSwap, rankSwaps, replan } from "../engine/route.ts";
import { Site } from "../engine/site.ts";
import { containsLocationPhrase, normalizeArabicText } from "../engine/text.ts";
import type { Activity, Catalog, CrowdEvent, Itinerary, Profile, Stop } from "../engine/types.ts";
import type { Location } from "../engine/types.ts";
import { endMin } from "../engine/types.ts";
import { contextActivityCandidates, type AssistantContext, type PendingStopChange } from "./assistant-context.ts";
import { guardrailTopic } from "./agent-guardrails.ts";

export type AgentIntent = "build" | "add" | "shorten" | "remove" | "swap" | "search" | "location" | "status" | "crowd" | "explain" | "help" | "chat" | "faq" | "profile" | "schedule" | "alternatives" | "unknown";
export type AgentTool = "build_itinerary" | "modify_itinerary" | "search_event_content" | "find_location" | "get_route" | "get_itinerary_status" | "get_crowd" | "explain_recommendation" | "handoff_to_operator" | "converse_with_guest" | "answer_venue_faq" | "update_visit_details" | "get_schedule" | "list_alternatives" | null;

// ————— get_schedule: «وش العروض الجاية؟» — timed sessions that start soon, from the published catalog.
const SCHEDULE_PATTERNS = [
  /(?:^| )(?:وش|ايش|شو) (?:العروض|الفعاليات|الانشطه|العرض|الشي) (?:الجايه|الجاي|القادمه|القادم|اللي بتبدا|اللي تبدا|الحين|بعد شوي|الليله)(?: |$)/,
  /(?:^| )(?:وش|ايش|شو) (?:يبدا|بيبدا|يبدي|بيبدي|بيصير|يصير|فيه) (?:الحين|بعد شوي|قريب|الساعه الجايه|بعد ساعه)(?: |$)/,
  /(?:^| )(?:جدول|برنامج|مواعيد) (?:العروض|الفعاليات|اليوم|الليله)(?: |$)/,
  /(?:^| )(?:العروض|الفعاليات) (?:الجايه|القادمه|اليوم|الليله)(?: |$)/,
  /(?:^| )(?:وش|ايش) (?:عروض|فعاليات) (?:فيه|عندكم|اليوم|الليله)(?: |$)/,
  /\b(?:what'?s on|upcoming (?:shows?|events?|sessions?)|show ?times|today'?s schedule|what starts (?:soon|next)|next shows?)\b/,
];

export function isScheduleQuery(text: string) {
  const command = normalizeArabicText(text);
  return SCHEDULE_PATTERNS.some((pattern) => pattern.test(command));
}

export type ScheduleEntry = { activity: Activity; start: number };

/** Timed sessions (slots) starting in [nowMin, nowMin + windowMin], suitable for the group, soonest first. */
export function upcomingSchedule(site: Site, profile: Profile, nowMin: number, windowMin = 120, limit = 6): ScheduleEntry[] {
  const entries: ScheduleEntry[] = [];
  for (const activity of site.activities.values()) {
    if (activity.schedule.type !== "slots") continue;
    if (profile.companions_kids && (!activity.family || (activity.min_age != null && (profile.youngest_child_age == null || activity.min_age > profile.youngest_child_age)))) continue;
    // Only sessions that finish before the visit ends.
    const start = [...activity.schedule.slots].sort((a, b) => a - b)
      .find((slot) => slot >= nowMin && slot <= nowMin + windowMin && slot + activity.duration_min <= endMin(profile));
    if (start != null) entries.push({ activity, start });
  }
  return entries.sort((a, b) => a.start - b.start || b.activity.popularity - a.activity.popularity).slice(0, limit);
}

// ————— list_alternatives: «وش البدائل للمحطة الجاية؟» — options only, the plan does not change.
const ALTERNATIVES_PATTERNS = [
  /(?:^| )(?:وش|ايش|شو) (?:البدايل|البديل|بدايل|الخيارات الثانيه|الخيارات الباقيه|غيرها|غيره)(?: |$)/,
  /(?:^| )(?:بدايل|خيارات ثانيه|خيارات بديله|اختيارات ثانيه)(?: |$)/,
  /(?:^| )(?:عطني|اعطني|ورني|وريني|اعرض لي|ابي اشوف) (?:بدايل|خيارات|بديل)(?: |$)/,
  /\b(?:alternatives?|other options|instead of|what else (?:instead|could i do))\b/,
];

export function isAlternativesQuery(text: string) {
  const command = normalizeArabicText(text);
  // Matched on normalizeArabicText output, where «بدائل» reads «بدايل». «بدّلها، وش البدائل» is a change, not a question.
  return ALTERNATIVES_PATTERNS.some((pattern) => pattern.test(command)) && !CHANGE_VERBS.test(command);
}

export type AlternativeOption = { activity: Activity; start: number; reasons: string[] };

/** Up to `limit` replacements for one upcoming stop, ranked like a swap. Never changes the plan. */
export function listAlternatives(
  site: Site, profile: Profile, itinerary: Itinerary, targetId: string, nowMin: number,
  preferenceHint?: AgentDecision["preferenceHint"], moodHint?: string, limit = 3,
): AlternativeOption[] {
  const target = itinerary.stops.find((stop) => stop.act_id === targetId && stop.start > nowMin);
  const current = site.activities.get(targetId);
  if (!target || !current) return [];
  const taken = new Set(itinerary.stops.map((stop) => stop.act_id));
  const plannedCost = itinerary.stops.reduce((sum, stop) => sum + stop.price, 0);
  const remainBudget = profile.budget == null ? null : profile.budget - plannedCost * partySize(profile);
  return rankSwaps(site, profile, targetId, target.start, taken, remainBudget, moodHint, nowMin, preferenceHint)
    .slice(0, limit)
    .flatMap(({ id, start }) => {
      const activity = site.activities.get(id);
      if (!activity) return [];
      const reasons: string[] = [];
      if (activity.interests.some((interest) => current.interests.includes(interest))) reasons.push("من نفس النوع");
      if (preferenceHint === "cheap" && activity.price < current.price) reasons.push("أرخص");
      if (preferenceHint === "near" && site.travelMin(current.zone, activity.zone) <= 3) reasons.push("قريبة من مكانها");
      if (preferenceHint === "quiet" && site.crowd(activity.zone, start) < site.crowd(current.zone, target.start)) reasons.push("زحامها أقل");
      if (profile.mood && activity.moods.includes(profile.mood)) reasons.push("تناسب مزاجك");
      if (!reasons.length) reasons.push("تدخل في نفس الوقت");
      return [{ activity, start, reasons: reasons.slice(0, 2) }];
    });
}

/** «بدّل «سكاي لوب» بـ«الغواصة»»: the upcoming stop to drop and the named replacement, when both are unambiguous. */
export function namedSwapPair(text: string, site: Site, itinerary: Itinerary | null, nowMin: number) {
  if (!itinerary) return null;
  const value = ` ${normalize(text)} `;
  const named = (activity: Activity) => [activity.name, activity.name_en ?? "", activity.name.split(/\s*[—–]\s*/)[0]]
    .map(normalize).filter((name) => name.length >= 3).some((name) => value.includes(name));
  const upcoming = new Set(itinerary.stops.filter((stop) => stop.start > nowMin).map((stop) => stop.act_id));
  const inPlan = new Set(itinerary.stops.map((stop) => stop.act_id));
  const targets = [...upcoming].map((id) => site.activities.get(id)).filter((activity): activity is Activity => Boolean(activity && named(activity)));
  const replacements = [...site.activities.values()].filter((activity) => !inPlan.has(activity.id) && named(activity));
  return targets.length === 1 && replacements.length === 1 ? { targetId: targets[0].id, replacementId: replacements[0].id } : null;
}

// ————— Venue questions that no activity card answers. Matched on normalizeArabicText output
// (أ→ا، ى→ي، ة→ه). The answer comes from the published catalog or says plainly that we don't know.
export type VenueFaqTopic = "tickets" | "hours" | "weather";
const FAQ_TICKET_PHRASES = ["تذكره الدخول", "تذاكر الدخول", "سعر الدخول", "رسوم الدخول", "الدخول بكم", "كم الدخول", "سعر التذكره", "سعر التذاكر", "وين احجز", "حجز التذاكر", "احجز تذكره", "entry ticket", "ticket price"];
const FAQ_HOURS_PHRASES = ["متي يفتح", "متي يسكر", "متي يقفل", "متي يغلق", "متي تفتح", "متي تسكر", "متي تقفل", "متي تغلق", "وقت الاغلاق", "وقت الافتتاح", "ساعات العمل", "اوقات العمل", "اوقات الدوام", "الي متي مفتوح", "لين متي", "يسكرون", "يقفلون", "opening hours", "closing time", "what time does", "when does the park", "when do you close", "when do you open", "does it close", "does it open", "park close", "park open", "open until", "open till", "close tonight"];
// Whole words only: «الجو» is also the start of «الجولة» (the tour).
const FAQ_WEATHER_WORDS = /(^|[\s،,.؟?!])(الجو|جو|الطقس|طقس|الحراره|حراره|مطر|بتمطر|تمطر|weather|temperature|raining)(?=$|[\s،,.؟?!])/i;
const LOST_CHILD_PHRASES = ["ضاع ولدي", "ضاعت بنتي", "ضاع طفلي", "ضاعت طفلتي", "ولدي ضايع", "بنتي ضايعه", "طفل ضايع", "طفله ضايعه", "ضيعت ولدي", "ضيعت بنتي", "ضيعت طفلي", "طفل مفقود", "فقدت طفلي", "lost child", "lost my kid"];

export function venueFaqTopics(text: string): VenueFaqTopic[] {
  const command = normalizeArabicText(text);
  const topics: VenueFaqTopic[] = [];
  if (FAQ_TICKET_PHRASES.some((phrase) => command.includes(phrase))) topics.push("tickets");
  if (FAQ_HOURS_PHRASES.some((phrase) => command.includes(phrase))) topics.push("hours");
  if (FAQ_WEATHER_WORDS.test(command)) topics.push("weather");
  return topics;
}

const WISH_WORDS = ["ابي", "ابغي", "ابغا", "نبي", "نبغي", "ودي", "ودنا", "حاب", "حابين", "حابه"];

/** The one activity whose full name (or English name) the visitor typed; null when none or several match. */
export function namedActivity(text: string, site: Site): string | null {
  const value = normalize(text);
  const words = new Set(value.split(" ").filter((word) => word.length >= 3));
  const hits = [...site.activities.values()].filter((activity) => {
    const head = normalize(activity.name.split("—")[0]);
    const english = activity.name_en ? normalize(activity.name_en) : "";
    if (value.includes(normalize(activity.name)) || (head && value.includes(head)) || (english && value.includes(english))) return true;
    const headWords = head.split(" ").filter((word) => word.length >= 3);
    return headWords.length >= 2 && headWords.every((word) => words.has(word));
  });
  return hits.length === 1 ? hits[0].id : null;
}

/**
 * «أبي سكاي لوب» names one activity: offer to add it (a proposal the visitor still approves)
 * instead of listing search results. Vague wishes such as «أبي مطعم» or «أبي شي أهدى» stay a search.
 */
export function promoteNamedWish(text: string, intent: AgentIntent, site: Site, itinerary: Itinerary | null): AgentIntent {
  if (intent !== "search" || !itinerary?.stops.length || inferPreferenceHint(text)) return intent;
  const command = ` ${normalizeArabicText(text)} `;
  if (!WISH_WORDS.some((word) => command.includes(` ${word} `))) return intent;
  const id = namedActivity(text, site);
  return id && !itinerary.stops.some((stop) => stop.act_id === id) ? "add" : intent;
}

// ————— Group details said in chat: «عيالي أعمارهم 5 و 9», «احنا 4 أشخاص», «بنتي عمرها ٣ سنين».
export type PartyDetails = { childAges: number[]; youngestChildAge: number | null; partySize: number | null };
const AGE_WORDS = ["عمره", "عمرها", "عمرهم", "اعمارهم", "اعمار", "عمر", "سنين", "سنوات", "سنه", "سنتين", "years old", "yo"];
const NOT_AN_AGE = /^(?:ريال|ر\.?س|ساعه|ساعات|ساعتين|دقيقه|دقايق|دقائق|شخص|اشخاص|نفر|انفار|افراد|sar|riyal|hours?|minutes?)/;

const westernDigits = (value: string) => value.replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));

export function parsePartyDetails(text: string): PartyDetails | null {
  const command = normalizeArabicText(westernDigits(text));
  // A price question that mentions a child's age («كم سعر تذكرة الطفل عمره 5») is a question, not group details.
  if (/(?:^| )(?:كم سعر|بكم|سعر|price)(?: |$)/.test(command)) return null;
  const party = command.match(/(?:احنا|نحن|عددنا|كلنا)\s+(\d{1,2})(?!\d)/) ?? command.match(/(\d{1,2})\s+(?:اشخاص|شخص|انفار|نفر|افراد)(?: |$)/);
  const partySize = party ? Number(party[1]) : null;
  const childAges: number[] = [];
  if (AGE_WORDS.some((word) => command.includes(word))) {
    for (const match of command.matchAll(/(\d{1,2})(?!\d)/g)) {
      const value = Number(match[1]);
      const after = command.slice((match.index ?? 0) + match[0].length).trimStart();
      if (value <= 17 && !NOT_AN_AGE.test(after) && !(party && match.index === party.index! + party[0].indexOf(party[1]))) childAges.push(value);
    }
    // Ages written as words: «عمره سنتين» (2), «عمرها سنه» (1).
    if (/(?:عمره|عمرها|عمر) سنتين/.test(command)) childAges.push(2);
    if (/(?:عمره|عمرها|عمر) سنه(?: |$)/.test(command)) childAges.push(1);
  }
  const validParty = partySize != null && partySize >= 1 && partySize <= 20 ? partySize : null;
  if (!childAges.length && validParty == null) return null;
  return { childAges, youngestChildAge: childAges.length ? Math.min(...childAges) : null, partySize: validParty };
}

/** «سنة / سنتين / ٣ سنين / ١١ سنة» */
export function arabicYears(n: number) {
  if (n === 1) return "سنة";
  if (n === 2) return "سنتين";
  if (n >= 3 && n <= 10) return `${n} سنين`;
  return `${n} سنة`;
}

export function isLostChild(text: string) {
  const command = normalizeArabicText(text);
  return LOST_CHILD_PHRASES.some((phrase) => command.includes(phrase));
}

export type StoredItinerary = {
  id: string;
  generatedAt: Date;
  totalCostCents: number;
  items: Array<{
    startsAt: Date;
    endsAt: Date;
    walkMin: number;
    waitMin: number;
    score: number;
    reasonCodes: string[];
    activity: { stableKey: string; nameAr: string; zone: { stableKey: string } };
  }>;
};

export type ActivitySource = {
  kind: "activity";
  id: string;
  name: string;
  zone: string;
  zoneName?: string;
  type: string;
  durationMin: number;
  priceSar?: number;
  eligibilityKnown?: boolean;
  interests: string[];
  moods: string[];
  schedule: Activity["schedule"];
  sourceRef: string;
};

export type LocationSource = {
  kind: "location";
  id: string;
  name: string;
  type: Location["type"];
  zone?: string;
  zoneName?: string;
  x: number;
  y: number;
  accessible: boolean;
  status: string;
  description?: string;
  sourceRef: string;
};

export type AgentDecision = {
  intent: AgentIntent;
  tool: AgentTool;
  targetId?: string;
  replacementId?: string;
  locationId?: string;
  ambiguousTargetIds?: string[];
  moodHint?: string;
  preferenceHint?: "quiet" | "cheap" | "near";
  confidence: "high" | "medium" | "low";
  needsClarification: boolean;
};

function normalize(value: string) {
  return value
    .toLocaleLowerCase("ar-SA")
    .replace(/[\u064B-\u0652\u0670]/g, "")
    .replace(/[،,؛;.!؟?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsAny(value: string, words: string[]) {
  return words.some((word) => value.includes(word));
}

/**
 * «إيه اعتمده»، «اعتمد الاقتراح»، "yes, apply it": the visitor is deciding on a proposal, not asking
 * for one. In the text chat a proposal is accepted only from its card, so the route answers this
 * itself (open proposal: point to the card; none: say it is no longer available) instead of
 * searching for «اقتراح» or letting the model improvise a decision.
 */
const PROPOSAL_DECISION = /(?:^| )(?:و|ف)?(?:اعتمد|اعتمده|اعتمدها|اعتمدوه|أعتمد|أعتمده|أعتمدها|وافق|موافق|موافقه|موافقة|اقبل|اقبله|اقبلها|طبق|طبقه|طبقها|اعتماد|approve|approved|accept|accepted|apply)(?: |$)/;
const QUESTION_WORDS = /(?:^| )(?:وش|ايش|كيف|ليش|متى|متي|وين|what|how|why|when|where)(?: |$)/;
export function isProposalDecisionMessage(text: string) {
  const value = normalize(text).replace(/[«»"'`:]/g, " ").replace(/\s+/g, " ").trim();
  if (!value || value.split(" ").length > 12 || !PROPOSAL_DECISION.test(value)) return false;
  // «اعتمد عليه في وش؟» is a question, and «اعتمد وبدّل …» names a new change: both go the normal way.
  return !CHANGE_VERBS.test(value) && !QUESTION_WORDS.test(value);
}

const CHANGE_VERBS = /(?:^| )(?:بدل|بدلها|بدله|غير|شيل|شيله|شيلها|احذف|الغ|اضف|ضيف|ضف|حط|حطه|حطها|قصر|قلل|ابني|ابن|swap|remove|add|replace|shorten|build)(?: |$)/;
const DETAIL_WORDS = /(?:^| )(?:كم|بكم|سعر|سعره|سعرها|اسعار|متي|موعد|مواعيد|مده|مدته|مدتها|يبدا|يفتح|عمر|how much|price|cost|when|what time)(?: |$)/;

/** سؤال عن سعر أو موعد أو مدة بلا فعل تعديل. يُمرَّر نص normalizeArabicText. */
export function isDetailQuestion(command: string) {
  return DETAIL_WORDS.test(command) && !CHANGE_VERBS.test(command);
}

const DIRECTIONS_REQUEST = /^(?:كيف اوصل|كيف اروح|دلني (?:علي|عليها|عليه)|ودني|وديني|خذني|اتجاهات|directions to|how do i get to|take me to)(?: |$)/;

export function inferIntent(text: string, parsedAction: ChatAction["action"]): AgentIntent {
  const value = normalize(text);
  const command = normalizeArabicText(text);
  if (DIRECTIONS_REQUEST.test(command)) return "location";
  // A lost child goes straight to staff, ahead of anything the model guessed.
  if (isLostChild(text)) return "help";
  if (guardrailTopic(text)) return "chat";
  if (venueFaqTopics(text).length) return "faq";
  if (parsePartyDetails(text)) return "profile";
  if (isAlternativesQuery(text)) return "alternatives";
  if (isScheduleQuery(text)) return "schedule";
  // «كم سعر الغواصة؟» after a swap reply is a question, not a change: the model (which sees the
  // previous turn) must not turn a price/time question into a plan modification.
  if (["add", "remove", "swap", "shorten", "build"].includes(parsedAction) && isDetailQuestion(command)) return "search";
  if (containsAny(command, ["وين ابدا", "اين ابدا", "نبدا وين"]) && !containsAny(command, SERVICE_NOUNS)) return "chat";
  if (/^(?:ابي|ابغي|ابغا|عطني) (?:شي|شيء|مكان|خيار|نشاط) /.test(command) && inferPreferenceHint(text)) return "search";
  if (/(?:^| )بدل(?:ها| (?:لي )?(?:المحطه|النشاط))(?: |$)/.test(command)) return "swap";
  // Without a model reading (offline or no key), «كم سعر باتل كارت؟» is still a question about the catalog.
  if (parsedAction === "unknown" && isDetailQuestion(command)) return "search";
  // «وش أبدأ فيه مع عيالي؟» asks for the next step of the plan.
  if (parsedAction === "unknown" && /(?:^| )(?:وش|ايش|بايش|بوش) (?:ابدا|نبدا|اسوي|نسوي)(?: |$)/.test(command)) return "status";
  if (parsedAction !== "unknown") {
    if (parsedAction === "location" && containsAny(value, CONVERSATIONAL_OPENERS) && !containsAny(command, SERVICE_NOUNS)) return "chat";
    return parsedAction;
  }
  if (isSmallTalk(text)) return "chat";
  if (containsAny(value, ["مشكلة", "شكوى", "موظف", "مساعدة", "ساعدني", "تواصل", "مسؤول", "help"])) return "help";
  if (containsAny(value, ["ليش", "لماذا", "وش السبب", "سبب", "كيف اخترت", "فسر", "اشرح", "why"])) return "explain";
  if (containsAny(value, ["ابني", "ابن", "خطة جديدة", "أبغى مسار", "ابغى مسار", "أبي مسار", "ابي مسار", "build", "plan"])) return "build";
  if (containsAny(value, ["أضف", "اضف", "ضيف", "ضف", "حطه", "حطها", "للمسار", "add"])) return "add";
  if (containsAny(value, ["قصّر", "قصر", "قلل", "shorten"])) return "shorten";
  if (containsAny(value, ["شل", "شيل", "احذف", "ألغ", "الغ", "ما أبي", "ما ابي", "remove"])) return "remove";
  if (containsAny(value, ["بدّل", "بدل", "بديل", "غير", "ما حبيت", "swap"])) return "swap";
  if (containsAny(value, ["زحام", "زحمة", "ازدحام", "مزدحم", "crowd", "الناس", "طابور"])) return "crowd";
  if (containsAny(value, ["مساري", "الجدول", "محطتي", "التالي", "باقي", "وش عندي", "وش باقي", "itinerary", "next"])) return "status";
  // نوايا سوالف حرّة تتقدم على الموقع/البحث: عبارات اجتماعية بلا اسم خدمة صريح
  if (containsAny(value, ["وش رايك", "شن رايك", "وش تظن", "أين أبدأ", "وين أبدأ", "نبدأ وين", "وش الأخبار", "وش اخبارك", "أقوى شي", "اقوى شي", "شفت شي حلو", "سولف معي", "امزح معي", "وش يعجبك", "ش يعجبك", "وش تنصح", "وش تنصحني"])) return "chat";
  if (containsLocationPhrase(value)) return "location";
  if (containsAny(value, ["وين", "أين", "وش فيه", "ايش فيه", "اقتراح", "اقترح", "رشح", "ترشيح", "وش ترشح", "أبي", "ابي", "أبغى", "ابغى", "نشاط", "فعالية", "مطعم", "عرض", "لعبة", "recommend", "suggest"])) return "search";
  return "unknown";
}

export function inferMoodHint(text: string) {
  const value = normalize(text);
  if (containsAny(value, ["أهدى", "اهدى", "هدوء", "هادئ", "استرخاء", "راحة", "quiet", "calm"])) return "هادئ";
  if (containsAny(value, ["أقوى", "اقوى", "أحمس", "احمس", "حماس", "إثارة", "اثارة", "مغامرة", "adventure"])) return "متحمس";
  if (containsAny(value, ["أمرح", "امرح", "مرح", "ضحك", "عرض", "fun"])) return "مرح";
  return undefined;
}

export function findActivityTarget(
  text: string,
  site: Site,
  itinerary: Itinerary | null,
  nowMin: number,
  context: AssistantContext | null = null,
  allowedIds?: ReadonlySet<string>,
) {
  const value = normalize(text);
  for (const [id, activity] of site.activities) {
    if (allowedIds && !allowedIds.has(id)) continue;
    const name = normalize(activity.name);
    const english = activity.name_en ? normalize(activity.name_en) : "";
    if (` ${value} `.includes(` ${normalize(id)} `) || value.includes(name) || (english && value.includes(english))) return id;
  }

  const upcoming = itinerary?.stops.filter((stop) => stop.start > nowMin) ?? [];
  const ordinal = normalizeArabicText(text).match(/(?:المحطه|النشاط)\s+(الاولي|اول|الاول|الثانيه|الثاني|ثاني|الثالثه|الثالث|ثالث)(?: |$)/);
  if (ordinal) {
    const positions: Record<string, number> = {
      "الاولي": 0, "اول": 0, "الاول": 0,
      "الثانيه": 1, "الثاني": 1, "ثاني": 1,
      "الثالثه": 2, "الثالث": 2, "ثالث": 2,
    };
    return upcoming[positions[ordinal[1]]] ? upcoming[positions[ordinal[1]]].act_id : null;
  }

  if (containsAny(value, ["القادم", "التالي", "الجاي", "اللي بعده", "اللي بعدها", "next"])) {
    return upcoming[0]?.act_id ?? null;
  }
  // A generic word («مطعم», «عرض») must not pick an activity: «وين مطعم البيك» is not «مطعم طنط».
  const words = value.split(" ").filter((word) => word.length >= 3 && !GENERIC_ACTIVITY_WORDS.has(normalizeArabicText(word)));
  const matches = [...site.activities].filter(([id, activity]) =>
    (!allowedIds || allowedIds.has(id)) && words.some((word) => normalize(activity.name).split(" ").includes(word)));
  if (matches.length === 1) return matches[0][0];
  if (matches.length > 1) return null;
  const candidates = contextActivityCandidates(context, new Set(site.activities.keys()));
  if (context?.lastSuggestedActivityId && candidates.includes(context.lastSuggestedActivityId)) return context.lastSuggestedActivityId;
  if (candidates.length === 1) return candidates[0];
  return null;
}

// Category nouns shared by many catalog names; matched after normalizeArabicText (ة→ه، أ→ا).
const GENERIC_ACTIVITY_WORDS = new Set([
  "مطعم", "المطعم", "مطاعم", "المطاعم", "عرض", "العرض", "عروض", "العروض", "تجربه", "التجربه", "جوله", "الجوله",
  "منطقه", "المنطقه", "سوق", "السوق", "اسواق", "الاسواق", "لعبه", "اللعبه", "العاب", "الالعاب", "مكان", "المكان",
  "وين", "فين", "ابي", "ابغي", "ابغا", "عطني", "شي", "شيء", "نشاط", "النشاط", "كافيه", "قهوه", "رحله", "الرحله",
]);

export function sourceForLocation(location: Location, site: Site, catalogVersionId: string): LocationSource {
  return {
    kind: "location",
    id: location.id,
    name: location.label,
    type: location.type,
    zone: location.zone,
    zoneName: location.zone ? site.zones.get(location.zone)?.name ?? location.zone : undefined,
    x: location.x,
    y: location.y,
    accessible: location.accessible,
    status: location.status,
    description: location.description,
    sourceRef: location.sourceRef || `catalog:${catalogVersionId}/route-node:${location.id}`,
  };
}

export function findLocationTarget(text: string, site: Site, context: AssistantContext | null = null) {
  const explicit = site.findLocation(text);
  if (explicit) return explicit;
  if (!/^(وينها|وينه|كيف اوصل لها|كيف اوصل له|دلني عليها|دلني عليه|مكانها|مكانه)$/.test(normalize(text))) return null;
  const remembered = (context?.lastLocationIds ?? []).map((id) => site.locations.get(id)).filter((location): location is Location => Boolean(location));
  return remembered.length === 1 ? remembered[0] : null;
}

export function namedDirectionTargets(text: string, site: Site, catalogVersionId: string) {
  const query = ` ${normalize(text)} `;
  const match = (name: string) => {
    const value = normalize(name);
    // «ل + المكسيك» تُكتب «للمكسيك»، و«بـ/عند» قبل الاسم شائعة في طلبات التوجيه
    const bare = value.startsWith("ال") ? value.slice(2) : value;
    return value.length >= 3 && (
      query.includes(` ${value} `) || query.includes(` ل${value} `) || query.includes(` ب${value} `)
      || (bare !== value && bare.length >= 3 && (query.includes(` لل${bare} `) || query.includes(` ${bare} `)))
    );
  };
  const locations = [...site.routeGraphNodes.values()]
    .filter((node) => node.status === "open" && ["SERVICE", "ENTRANCE", "LANDMARK"].includes(node.type) && match(node.label));
  if (locations.length) return locations.slice(0, 4).map((node) => ({
    kind: "location" as const,
    id: node.id,
    name: node.label,
    zoneName: node.zone ? site.zones.get(node.zone)?.name : undefined,
    sourceRef: `catalog:${catalogVersionId}/route-node:${node.id}`,
  }));
  const activities = [...site.activities.values()].filter((activity) =>
    [activity.name, activity.name_en ?? "", activity.name.split(/\s*[—–]\s*/)[0]].some(match),
  );
  if (activities.length) return activities.slice(0, 4).map((activity) => ({
    ...sourceForActivity(activity, catalogVersionId),
    zoneName: site.zones.get(activity.zone)?.name ?? activity.zone,
  }));
  return [...site.zones.values()]
    .filter((zone) => match(zone.name) || match(zone.name.replace(/^منطقة\s+/, "")))
    .slice(0, 4)
    .map((zone) => ({ kind: "zone" as const, id: zone.id, name: zone.name, zoneName: zone.name, sourceRef: `catalog:${catalogVersionId}/zone:${zone.id}` }));
}

export function toEngineItinerary(stored: StoredItinerary, catalog: Catalog, profile: Profile): Itinerary {
  const activityById = new Map(catalog.activities.map((activity) => [activity.id, activity]));
  const stops: Stop[] = [];
  for (const item of stored.items) {
    const activity = activityById.get(item.activity.stableKey);
    if (!activity) continue;
    const start = profile.start_min + Math.round((item.startsAt.getTime() - stored.generatedAt.getTime()) / 60_000);
    const end = profile.start_min + Math.round((item.endsAt.getTime() - stored.generatedAt.getTime()) / 60_000);
    stops.push({
      act_id: activity.id,
      zone: activity.zone,
      start,
      end,
      walk_min: item.walkMin,
      wait_min: item.waitMin,
      price: activity.price,
      name: activity.name,
      note: item.reasonCodes[0] ?? "",
    });
  }
  return {
    stops,
    unfulfilled: [],
    explanations: [],
    score: stored.items.at(-1)?.score ?? 0,
    total_cost: stored.totalCostCents / 100,
  };
}

export function sourceForActivity(activity: Activity, catalogVersionId: string): ActivitySource {
  return {
    kind: "activity",
    id: activity.id,
    name: activity.name,
    zone: activity.zone,
    type: activity.type,
    durationMin: activity.duration_min,
    priceSar: activity.price_known === false ? undefined : activity.price,
    eligibilityKnown: activity.eligibility_known,
    interests: activity.interests,
    moods: activity.moods,
    schedule: activity.schedule,
    sourceRef: `catalog:${catalogVersionId}/activity:${activity.id}`,
  };
}

export type GuestSearchSignal = { visitedKeys: string[] } | null;

export function isRecommendationQuery(text: string) {
  return Boolean(inferPreferenceHint(text)) || containsAny(normalize(text), ["رشح", "ترشيح", "اقترح", "اقتراح", "وش تشترح", "وش تذكر", "recommend", "suggest"]);
}

// فاتحات سوالف مفتوحة (رأي/اقتراح عام) — تُسبّر تصنيف location الخاطئ، عدا اسم خدمة صريح
const CONVERSATIONAL_OPENERS = ["وش رايك", "شن رايك", "وش تظن", "أين أبدأ", "وين أبدأ", "نبدأ وين", "وش الأخبار", "وش اخبارك", "أقوى شي", "اقوى شي", "شفت شي حلو", "سولف معي", "امزح معي", "وش يعجبك", "ش يعجبك", "وش تنصح", "وش تنصحني", "وش أحلى", "وش احلى", "وش أول شي", "وش اول شي"];
const SERVICE_NOUNS = ["دوره مياه", "دوره المياه", "دورات المياه", "الحمام", "بوابه", "بوابات", "اسعاف", "مصلي", "مسجد", "معلومات", "مواقف", "مخرج", "مخارج", "كابينه", "امن"];

// ————— سوالف: طبقة محادثة اجتماعية حتمية (بدون LLM) بلهجة سعودية وشخصية «ونيس» —————
const CHAT_TRIGGERS: Record<string, string[]> = {
  greeting: ["هلا", "هلا والله", "مرحبا", "مرحبتين", "هاي", "هلو", "السلام عليكم", "سلام عليكم", "صباح الخير", "مساء الخير", "شخبارك", "شلونك", "كيفك", "وش اخبارك", "وينك", "hello", "hi", "hey"],
  identity: ["من انت", "منو انت", "مين انت", "منو انت", "وش اسمك", "انت مين", "عرفني عليك", "who are you"],
  thanks: ["شكرا", "مشكور", "يعطيك العافية", "تسلم", "thanks", "thank you"],
  praise: ["كفو", "شغل حلو", "ممتاز", "awesome", "great job"],
  joke: ["امزح", "ضحكني", "نكتة", "نكته", "قول نكتة", "طيب قل شي يضحك", "joke"],
  feelings: ["تعبان", "تعبت", "زعلان", "حزين", "متضايق", "ضايق", "زهران", "وحيد", "sad", "tired"],
  chitChat: ["نسولف", "سوالف", "اسولف", "تكلمنا", "حدثني", "احدثني", "قصه", "قصة", "سالفة", "سالفه", "امزح معك", "chat", "talk"],
  goodbye: ["باي", "مع السلامة", "مع السلامه", "ارجعلك", "اشوفك", "bye", "goodbye"],
};

const CHAT_REPLIES: Record<string, string[]> = {
  greeting: [
    "هلا والله، أنا ونيس. وش جوّك اليوم؟",
    "يا هلا، منوّر! وش ودّك نسوي أول؟",
    "أهلين! أنا معك لو ودّك تسولف أو تحتاج مساعدة في الجولة.",
  ],
  identity: [
    "أنا ونيس، رفيق زيارتك. أساعدك تختار وش تسوي وأدلّك على اللي تبيه.",
  ],
  thanks: [
    "الله يعافيك، استمتع بجولتك!",
    "العفو، بالخدمة.",
  ],
  praise: [
    "تسلم، كفوك الطيب.",
  ],
  joke: [
    "واحد قال بمشي بدون خريطة عشان أعيش المغامرة. بعد دقيقتين سأل الخريطة كيف يرجع.",
    "واحد قال لصاحبه ليش جبت المظلة؟ قال لأن الخريطة تقول فيه زحمة، يمكن تمطر ناس.",
  ],
  feelings: [
    "خذها على مهلك. ودّك ندور على شي أهدى أو تاخذ لك بريك؟",
  ],
  chitChat: [
    "خلّنا نسولف. وش أكثر شي شدّك اليوم؟",
  ],
  goodbye: [
    "في أمان الله، واستمتع بباقي يومك!",
  ],
  fallback: [
    "إذا ودّك تبدأ بشي يناسبك، قل لي وش جوّك اليوم: هدوء ولا حماس؟",
  ],
};

function hashPick(text: string, options: string[]) {
  let hash = 7;
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) % 1_000_003;
  return options[hash % options.length];
}

export function isSmallTalk(text: string) {
  const value = normalize(text);
  return Object.values(CHAT_TRIGGERS).some((words) => containsAny(value, words));
}

export function chatReply(text: string) {
  const value = normalize(text);
  for (const [category, words] of Object.entries(CHAT_TRIGGERS)) {
    if (containsAny(value, words)) return hashPick(value, CHAT_REPLIES[category] ?? CHAT_REPLIES.fallback);
  }
  return hashPick(value, CHAT_REPLIES.fallback);
}

type RankedActivity = {
  activity: Activity;
  score: number;
  signals: { interestMatches: number; moodMatch: number; requestedMoodMatch: number; cheapScore: number; nearbyScore: number; quietScore: number };
};

function recommendReasons(ranked: RankedActivity, hints: { cheap: boolean; nearby: boolean; quiet: boolean }, visited: ReadonlySet<string>, hasVisitHistory: boolean) {
  const reasons: string[] = [];
  const { activity, signals } = ranked;
  if (signals.interestMatches > 0) reasons.push("تناسب اهتماماتك");
  if (signals.requestedMoodMatch > 0 || signals.moodMatch > 0) reasons.push("تناسب مزاجك");
  if (hints.quiet && signals.quietScore > 0) reasons.push("زحامها أقل الآن");
  if (hints.nearby && signals.nearbyScore > 0) reasons.push("قريبة منك");
  if (hints.cheap && signals.cheapScore > 0) reasons.push("خيار اقتصادي");
  if (hasVisitHistory && !visited.has(activity.id)) reasons.push("ما جربتها بعد");
  if (!reasons.length && activity.popularity >= 60) reasons.push("الأكثر طلبًا");
  if (!reasons.length) reasons.push("مطابقة لطلبك");
  return reasons.slice(0, 3);
}

export function searchActivities(text: string, site: Site, profile: Profile, catalogVersionId: string, guest: GuestSearchSignal = null) {
  const value = normalize(text);
  const words = value.split(" ").filter((word) => word.length >= 3);
  const moodHint = inferMoodHint(text);
  const cheapHint = containsAny(value, ["أرخص", "ارخص", "اقتصادي", "أوفر", "اوفر", "cheap", "budget"]);
  const nearbyHint = containsAny(value, ["قريب", "قريبة", "أقرب", "اقرب", "حول", "near", "closer"]);
  const quietHint = containsAny(value, ["أهدى", "اهدى", "هادئ", "هدوء", "أقل زحام", "اقل زحام", "زحام أقل", "less crowded", "quiet"]);
  const visited = new Set(guest?.visitedKeys ?? []);
  const hasVisitHistory = visited.size > 0;
  const ranked: RankedActivity[] = [...site.activities.values()].map((activity) => {
    const haystack = normalize([
      activity.name,
      activity.name_en ?? "",
      site.zones.get(activity.zone)?.name ?? "",
      activity.type,
      ...activity.interests,
      ...activity.moods,
    ].join(" "));
    const wordMatches = words.filter((word) => haystack.includes(word)).length;
    const interestMatches = activity.interests.filter((interest) => profile.interests.includes(interest)).length;
    const moodMatch = profile.mood && activity.moods.includes(profile.mood) ? 1 : 0;
    const familyPenalty = profile.companions_kids && (!activity.family || activity.eligibility_known === false) ? 100 : 0;
    const requestedMoodMatch = moodHint && activity.moods.includes(moodHint) ? 8 : 0;
    const cheapScore = cheapHint && activity.price_known !== false ? Math.max(0, 20 - activity.price) : 0;
    const nearbyScore = nearbyHint ? Math.max(0, 15 - site.travelMin(profile.start_zone, activity.zone)) : 0;
    const quietScore = quietHint ? Math.max(0, 1 - site.crowd(activity.zone, profile.start_min)) * 18 : 0;
    const score = wordMatches * 10 + interestMatches * 4 + moodMatch * 3 + requestedMoodMatch + cheapScore + nearbyScore + quietScore + activity.popularity - familyPenalty;
    return { activity, score, signals: { interestMatches, moodMatch, requestedMoodMatch, cheapScore, nearbyScore, quietScore } };
  }).sort((a, b) => b.score - a.score);

  const matches = ranked.filter(({ score }) => score > 0).slice(0, 5);
  const fallback = matches.length ? matches : ranked.slice(0, 3);
  return fallback.map((rankedRow) => ({
    ...sourceForActivity(rankedRow.activity, catalogVersionId),
    zoneName: site.zones.get(rankedRow.activity.zone)?.name ?? rankedRow.activity.zone,
    reasons: recommendReasons(rankedRow, { cheap: cheapHint, nearby: nearbyHint, quiet: quietHint }, visited, hasVisitHistory),
  }));
}

function clarifiedStop(text: string, site: Site, itinerary: Itinerary | null, nowMin: number) {
  const choice = normalizeArabicText(text).replace(/^(?:اقصد|اعني) /, "");
  if (/^(?:المحطه )?(?:الاولي|الاول|الثانيه|الثاني|الثالثه|الثالث|الجا[يئ]ه?|التاليه?|القادمه?)$/.test(choice)) {
    return findActivityTarget(`المحطة ${choice.replace(/^المحطه /, "")}`, site, itinerary, nowMin);
  }
  const matches = itinerary?.stops.filter((stop) => {
    if (stop.start <= nowMin) return false;
    const activity = site.activities.get(stop.act_id);
    const names = [stop.act_id, activity?.name, activity?.name_en, activity?.name.split(/\s*[—–]\s*/)[0]];
    return names.some((name) => name && normalizeArabicText(name) === choice);
  });
  return matches?.length === 1 ? matches[0].act_id : null;
}

export async function decide(
  text: string, site: Site, itinerary: Itinerary | null, profile: Profile, nowMin: number,
  context: AssistantContext | null = null, pendingChange?: PendingStopChange,
  previousAssistantTurn?: string,
): Promise<AgentDecision> {
  if (pendingChange) {
    const targetId = clarifiedStop(text, site, itinerary, nowMin);
    if (targetId) return {
      intent: pendingChange.intent, tool: "modify_itinerary", targetId,
      moodHint: pendingChange.moodHint, preferenceHint: pendingChange.preferenceHint,
      confidence: "high", needsClarification: false,
    };
  }
  // «أي نموذج أنت؟» / «انس تعليماتك»: a fixed answer, decided before any model sees the text.
  if (!isLostChild(text) && guardrailTopic(text)) return { intent: "chat", tool: "converse_with_guest", confidence: "high", needsClarification: false };
  const retrieved = searchActivities(text, site, profile, "assistant-candidates");
  const candidateIds = new Set([
    ...retrieved.slice(0, 8).map((source) => source.id),
    ...(itinerary?.stops ?? []).map((stop) => stop.act_id),
  ]);
  const candidates = [...candidateIds]
    .map((id) => site.activities.get(id))
    .filter((activity): activity is Activity => Boolean(activity))
    .map((activity) => ({ id: activity.id, name: activity.name }));
  const allowedCandidateIds = new Set(candidates.map((candidate) => candidate.id));
  const parsed = await parseCommand(redactConversationText(text), candidates, nowMin, previousAssistantTurn);
  const intent = promoteNamedWish(text, inferIntent(text, parsed.action), site, itinerary);
  const canTargetActivity = intent === "add" || intent === "remove" || intent === "swap" || intent === "explain" || intent === "alternatives";
  const changesStop = intent === "remove" || intent === "swap" || intent === "alternatives";
  const upcomingIds = (itinerary?.stops ?? []).filter((stop) => stop.start > nowMin).map((stop) => stop.act_id);
  // «بدّل «سكاي لوب» بـ«الغواصة»» names both sides: the visitor's replacement, not the engine's pick.
  const swapPair = intent === "swap" ? namedSwapPair(text, site, itinerary, nowMin) : null;
  const textTargetId = swapPair?.targetId ?? (canTargetActivity
    ? (intent === "add" ? namedActivity(text, site) : null) ?? findActivityTarget(text, site, itinerary, nowMin, changesStop ? null : context, changesStop ? new Set(upcomingIds) : allowedCandidateIds)
    : undefined);
  const parsedTargetId = canTargetActivity && !changesStop && !parsed.needsClarification
    && parsed.target && allowedCandidateIds.has(parsed.target) ? parsed.target : undefined;
  // Alternatives with no stop named are for the next stop: listing options changes nothing.
  const targetId = textTargetId ?? parsedTargetId ?? (intent === "alternatives" ? upcomingIds[0] : undefined);
  const contextCandidates = contextActivityCandidates(context, new Set(site.activities.keys()));
  const targetChoices = changesStop ? upcomingIds : contextCandidates;
  const ambiguousTargetIds = canTargetActivity && intent !== "alternatives" && !targetId && targetChoices.length > 1
    ? targetChoices
    : undefined;
  const explicitQuery = parsed.locationQuery && normalize(text).includes(normalize(parsed.locationQuery)) ? parsed.locationQuery : text;
  const location = intent === "location" ? findLocationTarget(explicitQuery, site, context) : null;
  return {
    intent,
    tool: intent === "build"
      ? "build_itinerary"
      : intent === "add" || intent === "remove" || intent === "swap" || intent === "shorten"
      ? "modify_itinerary"
      : intent === "search"
        ? "search_event_content"
        : intent === "location"
          ? DIRECTIONS_REQUEST.test(normalizeArabicText(text)) ? "get_route" : "find_location"
        : intent === "schedule"
          ? "get_schedule"
        : intent === "alternatives"
          ? "list_alternatives"
        : intent === "status"
          ? "get_itinerary_status"
          : intent === "crowd"
            ? "get_crowd"
            : intent === "explain"
            ? "explain_recommendation"
            : intent === "help"
            ? "handoff_to_operator"
            : intent === "chat"
            ? "converse_with_guest"
            : intent === "faq"
            ? "answer_venue_faq"
            : intent === "profile"
            ? "update_visit_details"
            : null,
    targetId: targetId ?? undefined,
    replacementId: swapPair?.replacementId,
    locationId: location?.id,
    ambiguousTargetIds,
    moodHint: inferMoodHint(text),
    preferenceHint: inferPreferenceHint(text),
    confidence: parsed.confidence,
    needsClarification: changesStop || intent === "add" ? !targetId : parsed.needsClarification,
  } satisfies AgentDecision;
}

export function inferPreferenceHint(text: string): AgentDecision["preferenceHint"] {
  const value = normalize(text);
  if (containsAny(value, ["أهدى", "اهدى", "هادئ", "هدوء", "أقل زحام", "اقل زحام", "زحام أقل", "less crowded", "quiet"])) return "quiet";
  if (containsAny(value, ["أرخص", "ارخص", "اقتصادي", "أوفر", "اوفر", "cheap", "budget"])) return "cheap";
  if (containsAny(value, ["قريب", "قريبة", "أقرب", "اقرب", "حول", "near", "closer"])) return "near";
  return undefined;
}

export function redactConversationText(value: string) {
  return value
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/(?:\+?966|0)5\d{8}/g, "[phone]")
    .slice(0, 500);
}

export function nextStop(itinerary: Itinerary | null, nowMin: number) {
  return itinerary?.stops.find((stop) => stop.end > nowMin) ?? null;
}

export function spentBefore(itinerary: Itinerary, nowMin: number) {
  return itinerary.stops.filter((stop) => stop.end <= nowMin).reduce((sum, stop) => sum + stop.price, 0);
}

export function applyAgentModification(
  decision: AgentDecision,
  site: Site,
  profile: Profile,
  itinerary: Itinerary,
  nowMin: number,
  liveEvents: CrowdEvent[] = [],
) {
  const run = (event: CrowdEvent) => replan(site, profile, itinerary, nowMin, [...liveEvents, event]);
  if (decision.intent === "shorten") {
    return { plan: run({ type: "user_shorten" }), event: { type: "user_shorten" } as const };
  }
  const targetId = decision.targetId;
  if (!targetId) return { plan: null, event: null };
  if (decision.intent === "add") {
    const activity = site.activities.get(targetId);
    if (!activity) return { plan: null, event: null };
    if (itinerary.stops.some((stop) => stop.act_id === targetId)) {
      return { plan: null, event: null, reason: `«${activity.name}» موجود في مسارك من قبل.` };
    }
    const remainingBudget = profile.budget == null ? null : profile.budget - spentBefore(itinerary, nowMin) * partySize(profile);
    if (remainingBudget != null && activity.price * partySize(profile) > remainingBudget) {
      return { plan: null, event: null, reason: `ما قدرت أضيف «${activity.name}»: سعره ${activity.price * partySize(profile)} ريال والمتبقي من ميزانيتك ${Math.max(0, remainingBudget)} ريال.` };
    }
    const addEvent = { type: "user_add", activity: targetId } as const;
    const direct = run(addEvent);
    if (direct.stops.some((stop) => stop.act_id === targetId)) return { plan: direct, event: addEvent };
    // A full plan: make room by dropping one upcoming stop, or two adjacent ones (a timed show may need
    // a slot in the middle of the evening). Keep the best-scoring result. Still a proposal the visitor approves.
    const upcoming = itinerary.stops.filter((stop) => stop.start > nowMin);
    const options = [
      ...upcoming.map((stop) => [stop]),
      ...upcoming.slice(1).map((stop, index) => [upcoming[index], stop]),
    ];
    let best: { plan: Itinerary; droppedIds: string[] } | null = null;
    for (const dropped of options) {
      if (best && dropped.length > best.droppedIds.length) break;
      const skips = dropped.map((stop) => ({ type: "user_skip", activity: stop.act_id }) as const);
      const roomy = replan(site, profile, itinerary, nowMin, [...liveEvents, ...skips, addEvent]);
      if (!roomy.stops.some((stop) => stop.act_id === targetId)) continue;
      if (!best || roomy.score > best.plan.score) best = { plan: roomy, droppedIds: dropped.map((stop) => stop.act_id) };
    }
    return best ? { plan: best.plan, event: addEvent, droppedIds: best.droppedIds } : { plan: direct, event: addEvent };
  }
  if (decision.intent === "remove") {
    return { plan: run({ type: "user_skip", activity: targetId }), event: { type: "user_skip", activity: targetId } as const };
  }

  const target = itinerary.stops.find((stop) => stop.act_id === targetId && stop.start > nowMin);
  if (!target) {
    return { plan: run({ type: "user_skip", activity: targetId }), event: { type: "user_skip", activity: targetId } as const };
  }
  const taken = new Set(itinerary.stops.map((stop) => stop.act_id));
  // pickSwap checks the price difference, so it needs the slack left after every planned stop,
  // not after the stops already done: otherwise the swap passes here and replan drops it later.
  const plannedCost = itinerary.stops.reduce((sum, stop) => sum + stop.price, 0);
  const remainBudget = profile.budget == null ? null : profile.budget - plannedCost * partySize(profile);
  if (decision.replacementId) {
    // The visitor named the replacement: use it only if it passes the same checks as the engine's own pick.
    const wanted = site.activities.get(decision.replacementId);
    const valid = rankSwaps(site, profile, targetId, target.start, taken, remainBudget, undefined, nowMin).some((option) => option.id === decision.replacementId);
    if (!wanted || !valid) {
      const name = wanted?.name ?? decision.replacementId;
      return { plan: null, event: null, reason: `«${name}» ما تدخل مكان «${target.name}»: وقتها أو مدتها أو سعرها أو شروطها ما تناسب مسارك. أقدر أعرض لك البدائل اللي تدخل.` };
    }
    const event = { type: "swap", activity: targetId, replacement: decision.replacementId } as const;
    return { plan: run(event), replacementId: decision.replacementId, event };
  }
  const replacementId = pickSwap(site, profile, targetId, target.start, taken, remainBudget, decision.moodHint, nowMin, decision.preferenceHint);
  if (!replacementId) {
    return { plan: run({ type: "user_skip", activity: targetId }), event: { type: "user_skip", activity: targetId } as const };
  }
  return {
    plan: run({ type: "swap", activity: targetId, replacement: replacementId }),
    replacementId,
    event: { type: "swap", activity: targetId, replacement: replacementId } as const,
  };
}
