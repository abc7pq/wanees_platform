// Understanding a visitor from what they say (audit items 1.1, 1.2, 1.7). No quiz: every message
// is read for who is visiting, children's ages, who likes what, budget, time, mood, mobility and
// language. This deterministic reader works without the model; when the model is available its
// extraction is validated (zod) and kept only where the visitor's own words support it, so the
// model never invents an interest.
import { z } from "zod";
import { isKnownTag, normalizeTagText, tagsInText } from "../../packages/engine/src/tags.ts";
import type { Like, LikeWho } from "../../packages/engine/src/types.ts";

export type PartyType = "solo" | "couple" | "friends" | "family";
export type ReplyLanguage = "ar" | "en" | "fr" | "ur";
export type BudgetLevel = "low" | "mid" | "high";

export type Understanding = {
  party: PartyType | null;
  partySize: number | null;
  childAges: number[];
  /** Children are mentioned («معي عيالي») even when no age was given. */
  hasChildren: boolean;
  likes: Like[];
  unmatched: string[];
  avoidTags: string[];
  budgetSar: number | null;
  budgetLevel: BudgetLevel | null;
  availableMinutes: number | null;
  untilClosing: boolean;
  mood: "هادئ" | "مرح" | "متحمس" | null;
  mobility: "wheelchair" | "stroller" | null;
  language: ReplyLanguage;
  /** The visitor wants something to do («ابي مسار», «وش اسوي؟») or told us enough to plan. */
  wantsPlan: boolean;
};

const WHO: readonly LikeWho[] = ["self", "group", "son", "daughter", "child", "partner", "friends"];

/** What the model may return; anything else is discarded (`strict`). */
export const modelUnderstandingSchema = z.object({
  party: z.enum(["solo", "couple", "friends", "family"]).nullable(),
  partySize: z.number().int().min(1).max(30).nullable(),
  childAges: z.array(z.number().int().min(0).max(17)).max(10),
  likes: z.array(z.object({
    who: z.enum(WHO as [LikeWho, ...LikeWho[]]),
    tag: z.string().min(1).max(40),
    /** The visitor's own word(s) the like comes from; must appear in the message. */
    evidence: z.string().min(1).max(60),
  }).strict()).max(12),
  unmatched: z.array(z.string().min(1).max(40)).max(5),
  avoidTags: z.array(z.string().min(1).max(40)).max(8),
  budgetSar: z.number().int().min(0).max(100_000).nullable(),
  availableMinutes: z.number().int().min(15).max(720).nullable(),
  mood: z.enum(["هادئ", "مرح", "متحمس"]).nullable(),
  mobility: z.enum(["wheelchair", "stroller"]).nullable(),
}).strict();
export type ModelUnderstanding = z.infer<typeof modelUnderstandingSchema>;

const western = (value: string) => value.replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))).replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
const PEOPLE_WORDS = "(?:ولدي|ولدنا|بنتي|بنتنا|ابني|ابننا|زوجتي|زوجي|مرتي|خطيبتي|خطيبي|حرمي|عيالي|عيالنا|اطفالي|اطفالنا|ربعي|اصحابي|اصدقائي|الشباب|الولد|البنت|انا|احنا)";
// «وزوجتي» → «و زوجتي»: the attached «و» before a person would hide the word from the matchers.
const DETACH_AND = new RegExp(`(^| )و(?=${PEOPLE_WORDS}( |$))`, "g");
const norm = (value: string) => normalizeTagText(western(value)).replace(DETACH_AND, "$1و ");
const has = (text: string, pattern: RegExp) => pattern.test(` ${text} `);

// ————— Language (item 1.7): Saudi Arabic by default; switch only on a full message in another language —————
const FRENCH_WORDS = /\b(je|nous|vous|avec|enfants?|bonjour|merci|est|une|des|pour|voudrais|veux|où|sont|famille|mon|ma|mes|aime|aiment|quoi|faire)\b/gi;
const URDU_LETTERS = /[ٹڈڑںےۓھہ]/g;

export function detectReplyLanguage(message: string, current: ReplyLanguage | null = null): ReplyLanguage {
  const text = message.trim();
  const arabicLetters = (text.match(/[؀-ۿ]/g) ?? []).length;
  const latinLetters = (text.match(/[A-Za-zÀ-ÿ]/g) ?? []).length;
  const words = text.split(/\s+/).filter(Boolean).length;
  if (arabicLetters >= 3) {
    // Urdu shares the script; its own letters give it away in a full sentence.
    if ((text.match(URDU_LETTERS) ?? []).length >= 2 && words >= 3) return "ur";
    // An Arabic sentence with an English word in it stays Arabic.
    return latinLetters > arabicLetters * 2 && words >= 3 ? latinLanguage(text) : "ar";
  }
  if (latinLetters >= 3 && words >= 2) return latinLanguage(text);
  // One word, digits or emoji: keep the current language.
  return current ?? "ar";
}

function latinLanguage(text: string): ReplyLanguage {
  return (text.match(FRENCH_WORDS) ?? []).length >= 2 || /[àâçéèêëîïôûùüÿœ]/i.test(text) ? "fr" : "en";
}

// ————— Party —————
const FAMILY = / (للعيال|للاطفال|للبزران|للعائله|للعايله|لعيالي|لاطفالي|عيالي|عيالنا|اطفالي|اطفالنا|بزراني|البزران|العيال|الاطفال|عائلتي|عايلتي|العائله|العايله|عائله|عايله|ولدي|ولدنا|ابني|ابننا|بنتي|بنتنا|طفلي|طفلتي|طفل|طفله|اولادي|kids|children|family|my son|my daughter|my child|our son|our daughter|toddler|baby) /;
const COUPLE = / (زوجتي|زوجي|مرتي|خطيبتي|خطيبي|حرمي|my wife|my husband|my fiancee|my fiance|my partner|couple) /;
const FRIENDS = / (شباب|الشباب|ربعي|الربع|اصحابي|اصدقائي|اخوياي|خوياي|طلعه شباب|طلعه بنات|صديقاتي|البنات|friends|buddies|the boys|the girls|mates) /;
const SOLO = / (لحالي|بروحي|وحدي|لوحدي|alone|by myself|on my own|solo) /;

function detectParty(text: string): PartyType | null {
  if (has(text, FAMILY)) return "family";
  if (has(text, FRIENDS)) return "friends";
  if (has(text, COUPLE)) return "couple";
  if (has(text, SOLO)) return "solo";
  return null;
}

const NUMBER_WORDS: Record<string, number> = {
  "واحد": 1, "اثنين": 2, "ثنين": 2, "اثنان": 2, "ثلاثه": 3, "ثلاث": 3, "اربعه": 4, "اربع": 4, "خمسه": 5, "خمس": 5,
  "سته": 6, "ست": 6, "سبعه": 7, "سبع": 7, "ثمانيه": 8, "ثمان": 8, "تسعه": 9, "تسع": 9, "عشره": 10, "عشر": 10,
  "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
};

function detectPartySize(text: string): number | null {
  const digits = text.match(/(?:احنا|نحن|عددنا|كلنا|we are|we're|party of|group of)\s+(\d{1,2})(?!\d)/) ?? text.match(/(\d{1,2})\s+(?:اشخاص|شخص|انفار|نفر|افراد|people|persons|of us)(?: |$)/);
  if (digits) return Number(digits[1]);
  const words = text.match(/(?:احنا|نحن|we are|we're)\s+([^\s]+)/);
  if (words && NUMBER_WORDS[words[1]]) return NUMBER_WORDS[words[1]];
  return null;
}

// ————— Children's ages —————
const AGE_CONTEXT = / (عمره|عمرها|عمرهم|اعمارهم|اعمار|عمر|سنين|سنوات|سنه|سنتين|years? old|year-old|yo|yrs|aged|age) /;
const NOT_AGE_AFTER = /^(?:ريال|ر س|ساعه|ساعات|ساعتين|دقيقه|دقايق|دقائق|شخص|اشخاص|نفر|انفار|افراد|sar|riyals?|hours?|hrs?|minutes?|mins?|people|persons)/;

function detectChildAges(text: string, partySize: number | null): number[] {
  // «my son is 7», «ولدي 6»: a child word right before the number is an age too.
  const childNumber = /(?:son|daughter|kid|child|boy|girl|ولدي|بنتي|ابني|طفلي|طفلتي|الولد|البنت)\s+(?:is\s+|عمره\s+|عمرها\s+)?\d{1,2}(?!\d)/.test(text);
  if (!childNumber && !has(text, AGE_CONTEXT)) return [];
  const ages: number[] = [];
  for (const match of text.matchAll(/(\d{1,2})(?!\d)/g)) {
    const value = Number(match[1]);
    const before = text.slice(0, match.index ?? 0);
    const after = text.slice((match.index ?? 0) + match[0].length).trimStart();
    if (value > 17 || NOT_AGE_AFTER.test(after)) continue;
    if (partySize === value && /(?:احنا|نحن|عددنا|كلنا|we are|we're|party of|group of)\s*$/.test(before)) continue;
    ages.push(value);
  }
  if (/(?:عمره|عمرها|عمر) سنتين/.test(text)) ages.push(2);
  if (/(?:عمره|عمرها|عمر) سنه(?: |$)/.test(text)) ages.push(1);
  return [...new Set(ages)].slice(0, 10);
}

// ————— Who likes what —————
// «…الحيوانات وولدي يحب…»: a new person starts a new clause, joined by an attached «و».
const CLAUSE_SPLIT = new RegExp(`\\s(?:لكن|بس|اما|but|and|while|whereas)\\s|\\sو\\s(?=${PEOPLE_WORDS}\\s(?!و\\s))|[،,.;!?؟\\n]`);
const LEADING_AND = /^و\s/;
const SON = / (ولدي|ولدنا|ابني|ابننا|الولد|my son|our son|the boy|my boy) /;
const DAUGHTER = / (بنتي|بنتنا|البنت|my daughter|our daughter|the girl|my girl) /;
const CHILDREN = / (للعيال|للاطفال|للبزران|لعيالي|عيالي|عيالنا|اطفالي|اطفالنا|البزران|العيال|الاطفال|طفلي|طفلتي|my kids|the kids|our kids|children|my children) /;
const PARTNER = / (زوجتي|زوجي|مرتي|خطيبتي|خطيبي|حرمي|my wife|my husband|my partner) /;
const FRIENDS_WHO = / (ربعي|الربع|اصحابي|اصدقائي|الشباب|خوياي|my friends|the guys) /;
const WE = / (احنا|نحب|نبي|نبغي|نحبها|كلنا|ودنا|we|we're|us|our) /;
const NEGATION = / (بدون|بلا|ما نبي|ما ابي|ما ابغي|لا نبي|ما نحب|ما احب|ما يحب|ما تحب|مو|مب|غير|no|not|without|don't|dont|hate|hates|avoid) /;

/** The person a clause is about, or null when it names nobody («and loves planes»). */
function explicitWho(clause: string): LikeWho | null {
  if (has(clause, SON)) return "son";
  if (has(clause, DAUGHTER)) return "daughter";
  if (has(clause, CHILDREN)) return "child";
  // «أنا وزوجتي نبي…»: a first-person plural verb means the whole group, not the partner alone.
  if (has(clause, / (نبي|نبغي|نحب|ودنا|نبا|we want|we like|we love|we'd like) /)) return "group";
  if (has(clause, PARTNER)) return "partner";
  if (has(clause, FRIENDS_WHO)) return "friends";
  if (has(clause, WE)) return "group";
  if (has(clause, / (انا|احب|ابي|ابغي|ودي|حاب|i|i'm|i am|me|my|i like|i love) /)) return "self";
  return null;
}

/** «ولدي يحب X» where X matches no tag: keep up to three of the visitor's own words. */
function unmatchedLike(clause: string): string | null {
  const match = clause.match(/(?:يحب|تحب|يحبون|احب|نحب|مهتم ب|مهتمين ب|يموت على|تموت على|likes?|loves?|into|interested in)\s+(.+)$/);
  if (!match) return null;
  const words = match[1].split(" ").filter((word) => word.length > 1).slice(0, 3).join(" ");
  return words && !tagsInText(words).length ? words.slice(0, 40) : null;
}

function detectLikes(message: string, party: PartyType | null) {
  const likes: Like[] = [];
  const avoid: string[] = [];
  const unmatched: string[] = [];
  // A clause that names nobody continues the last person named: «my son is 7 and loves planes».
  let lastWho: LikeWho | null = null;
  // Punctuation is gone after normalizing, so split the visitor's sentence on it first.
  const clauses = western(message).split(/[،,.;!?؟\n]/).flatMap((part) => norm(part).split(CLAUSE_SPLIT));
  for (const raw of clauses) {
    const clause = raw.trim().replace(LEADING_AND, "");
    if (!clause) continue;
    const tags = tagsInText(clause);
    const negated = has(clause, NEGATION);
    if (negated) {
      avoid.push(...tags);
      continue;
    }
    const named = explicitWho(clause);
    if (named) lastWho = named;
    const who = named ?? lastWho ?? (party === "family" || party === "friends" ? "group" : "self");
    for (const tag of tags) {
      // «معي عيالي» says who is coming, not that they like children's activities.
      if (tag === "أطفال" && who !== "self" && who !== "group") continue;
      if (tag === "أطفال" && has(clause, CHILDREN)) continue;
      likes.push({ who, tag });
    }
    if (!tags.length) {
      const words = unmatchedLike(clause);
      if (words) unmatched.push(words);
    }
  }
  const unique = new Map(likes.map((like) => [`${like.who}:${like.tag}`, like]));
  return { likes: [...unique.values()].slice(0, 20), avoidTags: [...new Set(avoid)], unmatched: [...new Set(unmatched)].slice(0, 5) };
}

// ————— Budget, time, mood, mobility —————
function detectBudget(text: string): { sar: number | null; level: BudgetLevel | null } {
  const amount = text.match(/(?:ميزانيتي|ميزانيتنا|ميزانيه|ميزانيه|معي|معاي|عندي|عندنا|حدود|budget(?: is| of)?|up to|under|max)\s*(\d{2,6})\s*(?:ريال|ر س|sar|riyals?)?/)
    ?? text.match(/(\d{2,6})\s*(?:ريال|ر س|sar|riyals?)/);
  if (amount && !/ساع|دقي|hour|min/.test(text.slice((amount.index ?? 0) + amount[0].length, (amount.index ?? 0) + amount[0].length + 8))) {
    return { sar: Number(amount[1]), level: null };
  }
  if (has(text, / (رخيص|رخيصه|ارخص|على قد الحال|على القد|ميزانيه محدوده|ميزانيتي محدوده|ما معي كثير|توفير|cheap|budget friendly|affordable|low budget|not expensive) /)) return { sar: null, level: "low" };
  if (has(text, / (السعر مو مشكله|الفلوس مو مشكله|ما يهمني السعر|ما تهمني الفلوس|فخم|vip|money is no object|price doesn't matter|premium|luxury) /)) return { sar: null, level: "high" };
  return { sar: null, level: null };
}

function detectTime(text: string): { minutes: number | null; untilClosing: boolean } {
  if (has(text, / (لين يسكرون|لين يقفلون|لين الاغلاق|لين نهايه اليوم|طول الليل|الليل كله|until closing|till closing|all night) /)) return { minutes: null, untilClosing: true };
  if (has(text, / (نص ساعه|half an hour|30 minutes|30 mins) /)) return { minutes: 30, untilClosing: false };
  if (has(text, / (ساعه ونص|ساعه و نص|an hour and a half|1\.5 hours|90 minutes) /)) return { minutes: 90, untilClosing: false };
  if (has(text, / (ساعتين ونص|ساعتين و نص|two and a half hours|2\.5 hours) /)) return { minutes: 150, untilClosing: false };
  if (has(text, / (ساعتين|two hours|2 hours|2 hrs) /)) return { minutes: 120, untilClosing: false };
  const hours = text.match(/(\d{1,2}(?:\.\d)?)\s*(?:ساعات|ساعه|hours?|hrs?)/);
  if (hours) return { minutes: Math.min(720, Math.max(30, Math.round(Number(hours[1]) * 60))), untilClosing: false };
  if (has(text, / (ساعه|ساعه وحده|ساعه بس|an hour|one hour|1 hour) /)) return { minutes: 60, untilClosing: false };
  const minutes = text.match(/(\d{2,3})\s*(?:دقيقه|دقايق|دقائق|minutes?|mins?)/);
  if (minutes && Number(minutes[1]) >= 15) return { minutes: Math.min(720, Number(minutes[1])), untilClosing: false };
  return { minutes: null, untilClosing: false };
}

function detectMood(text: string): Understanding["mood"] {
  if (has(text, / (هادي|هادئ|هدوء|رايق|روقان|استرخاء|تعبان|تعبانين|بعيد عن الزحمه|calm|quiet|relaxed|relax|chill|tired) /)) return "هادئ";
  if (has(text, / (حماس|متحمس|متحمسين|اكشن|ادرينالين|اثاره|مغامره|قوي|اقوى شي|thrill|exciting|excited|adrenaline|action|adventure|extreme) /)) return "متحمس";
  if (has(text, / (وناسه|ونسه|ضحك|مرح|ممتع|نستانس|fun|laugh|enjoy) /)) return "مرح";
  return null;
}

function detectMobility(text: string): Understanding["mobility"] {
  if (has(text, / (كرسي متحرك|كرسي|كراسي متحركه|مقعد|ذوي الاعاقه|wheelchair|disabled|mobility) /)) return "wheelchair";
  if (has(text, / (عربيه اطفال|عربه اطفال|عربيه|عربه|عرباه|stroller|pram|pushchair|buggy) /)) return "stroller";
  return null;
}

const PLAN_REQUEST = / (ابي مسار|ابغي مسار|نبي مسار|سو لي مسار|سوي لي مسار|ابني لي|رتب لي|رتبي لي|خطط لي|خطه|جوله|جولتي|مساري|مسار|وش اسوي|وش نسوي|ايش اسوي|ايش نسوي|وين اروح|وين نروح|من وين ابدا|من وين نبدا|اقترح|اقترح لي|وش تنصح|plan|itinerary|what should i do|what should we do|where should we go|where do we start|suggest|recommend|tour) /;

export function understandMessage(message: string, previousLanguage: ReplyLanguage | null = null): Understanding {
  const text = norm(message);
  const party = detectParty(text);
  const partySize = detectPartySize(text);
  const childAges = detectChildAges(text, partySize);
  const { likes, avoidTags, unmatched } = detectLikes(message, party);
  const budget = detectBudget(text);
  const time = detectTime(text);
  const mood = detectMood(text);
  const mobility = detectMobility(text);
  const hasChildren = party === "family" && (childAges.length > 0 || has(text, CHILDREN) || has(text, SON) || has(text, DAUGHTER) || has(text, / (طفل|طفله|بزر|kid|kids|baby|toddler) /));
  const told = Boolean(party || partySize || childAges.length || likes.length || unmatched.length || budget.sar || budget.level || time.minutes || time.untilClosing || mood || mobility);
  return {
    party: party ?? (childAges.length ? "family" : null),
    partySize: partySize != null && partySize >= 1 && partySize <= 30 ? partySize : null,
    childAges,
    hasChildren: hasChildren || childAges.length > 0,
    likes,
    unmatched,
    avoidTags,
    budgetSar: budget.sar,
    budgetLevel: budget.level,
    availableMinutes: time.minutes,
    untilClosing: time.untilClosing,
    mood,
    mobility,
    language: detectReplyLanguage(message, previousLanguage),
    wantsPlan: told || has(text, PLAN_REQUEST),
  };
}

/**
 * Keeps the model's extraction only where the visitor's words support it: a like needs a known
 * tag and evidence that appears in the message; unmatched words must appear in the message. The
 * deterministic reading wins on every conflict, so a model error can only add, never contradict.
 */
export function mergeModelUnderstanding(message: string, base: Understanding, model: unknown): Understanding {
  const parsed = modelUnderstandingSchema.safeParse(model);
  if (!parsed.success) return base;
  const text = norm(message);
  const said = (words: string) => {
    const value = norm(words);
    return value.length >= 2 && ` ${text} `.includes(value);
  };
  const extra = parsed.data;
  const likes = new Map(base.likes.map((like) => [`${like.who}:${like.tag}`, like]));
  for (const like of extra.likes) {
    if (!isKnownTag(like.tag) || !said(like.evidence) || base.avoidTags.includes(like.tag)) continue;
    // Every tag the evidence names must be the tag claimed: «طيران» from «يحب الطيارات», not «رعب».
    const evidenceTags = tagsInText(like.evidence);
    if (evidenceTags.length && !evidenceTags.includes(like.tag)) continue;
    if (![...likes.values()].some((known) => known.tag === like.tag)) likes.set(`${like.who}:${like.tag}`, { who: like.who, tag: like.tag });
  }
  const childAges = base.childAges.length ? base.childAges : extra.childAges.filter((age) => said(String(age)));
  return {
    ...base,
    party: base.party ?? extra.party,
    partySize: base.partySize ?? (extra.partySize != null && said(String(extra.partySize)) ? extra.partySize : null),
    childAges,
    hasChildren: base.hasChildren || childAges.length > 0,
    likes: [...likes.values()].slice(0, 20),
    unmatched: [...new Set([...base.unmatched, ...extra.unmatched.filter(said)])].slice(0, 5),
    avoidTags: [...new Set([...base.avoidTags, ...extra.avoidTags.filter((tag) => isKnownTag(tag) && tagsInText(message).includes(tag))])],
    budgetSar: base.budgetSar ?? (extra.budgetSar != null && said(String(extra.budgetSar)) ? extra.budgetSar : null),
    availableMinutes: base.availableMinutes ?? extra.availableMinutes,
    mood: base.mood ?? extra.mood,
    mobility: base.mobility ?? extra.mobility,
  };
}

// ————— Stored preferences —————
export type UnderstoodPreferences = {
  companions: string | null;
  partySize: number | null;
  youngestChildAge: number | null;
  childAges: number[];
  likes: string[];
  unmatchedInterests: string[];
  avoidTags: string[];
  interests: string[];
  mood: string | null;
  budgetMaxCents: number | null;
  availableMinutes: number | null;
  mobility: string | null;
  replyLanguage: string | null;
};

const COMPANIONS: Record<PartyType, string> = { solo: "لحالي", couple: "شخصين", friends: "أصدقاء", family: "عائلة وأطفال" };
const ADULTS: Record<PartyType, number> = { solo: 1, couple: 2, friends: 3, family: 2 };

/** The party a stored companions value describes, whatever wording an older client stored. */
export function partyOf(companions: string | null | undefined): PartyType | null {
  if (!companions) return null;
  if (/family|child|kid|أطفال|طفل|عائل|عايل/i.test(companions)) return "family";
  if (/solo|alone|لحالي|فردي|وحدي/i.test(companions)) return "solo";
  if (/couple|زوج|شخصين|اثنين/i.test(companions)) return "couple";
  if (/friend|أصدقاء|اصدقاء|شباب|ربع/i.test(companions)) return "friends";
  return null;
}

export function encodeLike(like: Like) {
  return `${like.who}:${like.tag}`;
}

export function decodeLikes(values: readonly string[] | null | undefined): Like[] {
  return (values ?? []).flatMap((value) => {
    const index = value.indexOf(":");
    const who = value.slice(0, index) as LikeWho;
    const tag = value.slice(index + 1);
    return index > 0 && WHO.includes(who) && isKnownTag(tag) ? [{ who, tag }] : [];
  });
}

/**
 * Applies what was understood to the stored preferences. New facts replace old ones; likes
 * accumulate (a tag the visitor now says to avoid is removed). Returns the changed field names.
 */
export function applyUnderstanding(current: Partial<UnderstoodPreferences> | null | undefined, u: Understanding, closingMinutesLeft: number | null = null) {
  const before: UnderstoodPreferences = {
    companions: current?.companions ?? null,
    partySize: current?.partySize ?? null,
    youngestChildAge: current?.youngestChildAge ?? null,
    childAges: current?.childAges ?? [],
    likes: current?.likes ?? [],
    unmatchedInterests: current?.unmatchedInterests ?? [],
    avoidTags: current?.avoidTags ?? [],
    interests: current?.interests ?? [],
    mood: current?.mood ?? null,
    budgetMaxCents: current?.budgetMaxCents ?? null,
    availableMinutes: current?.availableMinutes ?? null,
    mobility: current?.mobility ?? null,
    replyLanguage: current?.replyLanguage ?? null,
  };
  const next: UnderstoodPreferences = { ...before };
  // The same party said again («للعيال» when the visitor already came as a family) is not a change.
  if (u.party && partyOf(before.companions) !== u.party) next.companions = COMPANIONS[u.party];
  const childAges = u.childAges.length ? [...new Set([...before.childAges, ...u.childAges])].sort((a, b) => a - b).slice(0, 10) : before.childAges;
  next.childAges = childAges;
  next.youngestChildAge = childAges.length ? Math.min(...childAges) : before.youngestChildAge;
  if (u.hasChildren && partyOf(next.companions) !== "family") next.companions = COMPANIONS.family;
  const adults = u.party ? ADULTS[u.party] : before.partySize ? Math.max(1, before.partySize - before.childAges.length) : 1;
  next.partySize = u.partySize ?? (childAges.length > before.childAges.length || (u.party && !before.partySize) ? Math.max(before.partySize ?? 0, adults + childAges.length) : before.partySize);
  const avoid = new Set([...before.avoidTags.filter((tag) => !u.likes.some((like) => like.tag === tag)), ...u.avoidTags]);
  next.avoidTags = [...avoid];
  const likes = new Map(decodeLikes(before.likes).map((like) => [encodeLike(like), like]));
  for (const like of u.likes) likes.set(encodeLike(like), like);
  next.likes = [...likes.values()].filter((like) => !avoid.has(like.tag)).map(encodeLike).slice(0, 20);
  next.interests = [...new Set([...before.interests, ...u.likes.map((like) => like.tag)])].filter((tag) => !avoid.has(tag)).slice(0, 12);
  next.unmatchedInterests = [...new Set([...before.unmatchedInterests, ...u.unmatched])].slice(0, 5);
  if (u.mood) next.mood = u.mood;
  if (u.budgetSar != null) next.budgetMaxCents = u.budgetSar * 100;
  else if (u.budgetLevel === "low") next.budgetMaxCents = 100 * 100 * Math.max(1, next.partySize ?? 1);
  else if (u.budgetLevel === "high") next.budgetMaxCents = null;
  if (u.availableMinutes) next.availableMinutes = u.availableMinutes;
  else if (u.untilClosing && closingMinutesLeft) next.availableMinutes = Math.max(30, closingMinutesLeft);
  if (u.mobility) next.mobility = u.mobility;
  next.replyLanguage = u.language;
  const changed = (Object.keys(next) as (keyof UnderstoodPreferences)[]).filter((key) => JSON.stringify(next[key]) !== JSON.stringify(before[key]) && key !== "replyLanguage");
  return { preferences: next, changed };
}

// ————— Assumptions and the one question (item 1.2) —————
export type Assumption = { key: "time" | "safety" | "budget" | "party"; label: string; message: string };

/**
 * The defaults the plan used, as tappable chips: tapping one types a sentence that corrects it.
 * Only assumptions still in force are listed.
 */
export function planAssumptions(preferences: Partial<UnderstoodPreferences> | null | undefined, language: ReplyLanguage = "ar"): Assumption[] {
  const en = language !== "ar";
  const list: Assumption[] = [];
  if (!preferences?.availableMinutes) list.push(en ? { key: "time", label: "3 hours", message: "I only have an hour" } : { key: "time", label: "3 ساعات", message: "عندي ساعة بس" });
  const agesKnown = (preferences?.childAges?.length ?? 0) > 0 || preferences?.youngestChildAge != null;
  if (!agesKnown && !(preferences?.avoidTags ?? []).length && !(preferences?.likes ?? []).some((like) => like.endsWith(":رعب"))) {
    list.push(en ? { key: "safety", label: "no horror", message: "We like horror" } : { key: "safety", label: "بدون رعب", message: "نحب الرعب" });
  }
  if (preferences?.budgetMaxCents == null) list.push(en ? { key: "budget", label: "mid budget", message: "Something cheap please" } : { key: "budget", label: "ميزانية متوسطة", message: "أبي شي رخيص" });
  if (!preferences?.companions) list.push(en ? { key: "party", label: "group unknown", message: "I'm with my kids" } : { key: "party", label: "بدون أطفال صغار", message: "معي عيالي" });
  return list;
}

export function assumptionLine(assumptions: readonly Assumption[], language: ReplyLanguage = "ar") {
  if (!assumptions.length) return "";
  return language === "ar" ? `افترضت: ${assumptions.map((item) => item.label).join(" · ")}` : `Assumed: ${assumptions.map((item) => item.label).join(" · ")}`;
}

/**
 * At most one question, and only when the answer changes safety or the plan: children with no
 * age (age limits), or a wheelchair/stroller that may not fit every walkway is handled without asking.
 */
export function followUpQuestion(preferences: Partial<UnderstoodPreferences> | null | undefined, language: ReplyLanguage = "ar"): string | null {
  const family = preferences?.companions === COMPANIONS.family;
  const agesKnown = (preferences?.childAges?.length ?? 0) > 0 || preferences?.youngestChildAge != null;
  if (family && !agesKnown) return language === "ar" ? "كم عمر أصغر طفل معكم؟ عشان أستبعد اللي ما يناسبه." : "How old is your youngest child? I'll leave out anything not suitable.";
  return null;
}
