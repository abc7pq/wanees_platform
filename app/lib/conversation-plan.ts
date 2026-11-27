// Conversation drives the plan (audit items 1.1 and 1.2). Pure helpers used by the assistant route:
// when a message should build or re-plan, whether the visit has started, and the deterministic
// reply that presents an instant plan with its assumptions and at most one question.
import type { Site } from "../engine/site.ts";
import type { Itinerary, Profile } from "../engine/types.ts";
import { fitReasons } from "../../packages/engine/src/matching.ts";
import { stationsCount } from "./ar-count.ts";
import type { Assumption, ReplyLanguage, Understanding } from "./visitor-understanding.ts";
import { assumptionLine } from "./visitor-understanding.ts";
import { joinNames } from "./zone-picks.ts";

/** Facts that change which activities fit, so the plan is rebuilt when one of them changes. */
const PLAN_FACTS = new Set(["companions", "partySize", "youngestChildAge", "childAges", "likes", "avoidTags", "interests", "mood", "budgetMaxCents", "availableMinutes", "mobility"]);

export function changesPlan(changed: readonly string[]) {
  return changed.some((field) => PLAN_FACTS.has(field));
}

/** The visit has started once the first planned stop's time has come. */
export function visitStarted(plan: Pick<Itinerary, "stops"> | null, nowMin: number) {
  return Boolean(plan?.stops.some((stop) => stop.start <= nowMin));
}

/**
 * What a conversational message should do to the plan, if anything:
 * - "build": no plan yet and the visitor showed any intent to visit (item 1.2);
 * - "profile": a plan exists and the message changed a fact that affects it;
 * - null: leave the decision to the normal intent routing.
 * Questions about places, prices, schedules, directions or emergencies keep their own intent.
 */
export function conversationPlanIntent(input: {
  intent: string;
  understood: Understanding;
  changed: readonly string[];
  hasPlan: boolean;
  categoryRequest: boolean;
}): "build" | "profile" | null {
  const conversational = ["chat", "unknown", "build", "profile", "search", "status"].includes(input.intent);
  if (!conversational || input.categoryRequest) return null;
  if (!input.hasPlan) return input.understood.wantsPlan ? "build" : null;
  // A search that only carried a mood or a budget hint stays a search; a fact about the party,
  // their likes, ages, time or budget re-plans.
  if (input.intent === "search" && !input.changed.some((field) => ["companions", "partySize", "youngestChildAge", "childAges", "likes", "avoidTags", "availableMinutes", "budgetMaxCents", "mobility"].includes(field))) return null;
  return changesPlan(input.changed) ? "profile" : null;
}

/**
 * The opening in words (agent v8): where to go, not what to do. Two or three zones picked for this
 * visitor and the one question that shapes the evening («وش جوك؟»). No activity is named.
 */
export function openingDraft(input: { zoneNames: readonly string[]; question: string | null; language: ReplyLanguage }) {
  const en = input.language !== "ar";
  const names = joinNames(input.zoneNames.slice(0, 3), en ? "en" : "ar");
  const where = !names
    ? en ? "Welcome! I'm Wanees, your guide tonight." : "حيّاك الله! أنا ونيس، رفيقك الليلة."
    : en ? `Welcome! Tonight I'd head to ${names}.` : `حيّاك الله! أحس الليلة بتعجبك ${names}.`;
  return [where, input.question].filter(Boolean).join(" ");
}

/** The zones a plan passes through, in visiting order, without repeats. */
export function planZoneNames(plan: Pick<Itinerary, "stops">, site: Site, limit = 3) {
  const names: string[] = [];
  for (const stop of plan.stops) {
    const name = site.zones.get(stop.zone)?.name ?? stop.zone;
    if (!names.includes(name)) names.push(name);
  }
  return names.slice(0, limit);
}

/**
 * The instant plan in words, built from the engine result: the number of stops, the zones it
 * passes through, the first stop with the engine's reason, the assumptions still in force, and
 * the one question if any.
 */
export function instantPlanDraft(input: {
  plan: Itinerary;
  site: Site;
  profile: Profile;
  assumptions: readonly Assumption[];
  question: string | null;
  language: ReplyLanguage;
  replanned?: boolean;
  /** On a screen the assumptions are tappable chips under the reply, so the text does not repeat them. Default: say them. */
  sayAssumptions?: boolean;
}) {
  const en = input.language !== "ar";
  const first = input.plan.stops[0];
  if (!first) {
    return en
      ? "I couldn't fit a valid plan into the time and limits you gave. Tell me more time or a bigger budget and I'll try again."
      : "ما قدرت أبني جولة صالحة ضمن الوقت والقيود الحالية. زد الوقت أو الميزانية وأجرب لك مرة ثانية.";
  }
  const activity = input.site.activities.get(first.act_id);
  const reason = activity ? fitReasons(activity, input.profile, en ? "en" : "ar")[0] : undefined;
  const firstName = en ? activity?.name_en ?? first.name : first.name;
  // Where the visitor is going comes before what they will do there.
  const zones = joinNames(planZoneNames(input.plan, input.site), en ? "en" : "ar");
  const opening = en
    ? `${input.replanned ? "Updated your plan" : "Here's your plan"}: ${input.plan.stops.length} stop${input.plan.stops.length === 1 ? "" : "s"}${zones ? ` through ${zones}` : ""}, starting with «${firstName}»${reason ? ` ${reason}` : ""}.`
    : `${input.replanned ? "حدّثت جولتك" : "جهزت لك جولة"} من ${stationsCount(input.plan.stops.length)}${zones ? ` تمرّ على ${zones}` : ""}، أولها «${first.name}»${reason ? ` ${reason}` : ""}.`;
  const assumed = input.sayAssumptions === false ? "" : assumptionLine(input.assumptions, input.language === "ar" ? "ar" : "en");
  return [opening, assumed ? `${assumed}.` : null, input.question].filter(Boolean).join(" ");
}

const WHO_PHRASE_AR: Record<string, string> = { self: "إنك تحب", group: "إنكم تحبون", son: "إن ولدك يحب", daughter: "إن بنتك تحب", child: "إن عيالك يحبون", partner: "إن شريكك يحب", friends: "إن ربعك يحبون" };
const WHO_PHRASE_EN: Record<string, string> = { self: "you like", group: "you all like", son: "your son likes", daughter: "your daughter likes", child: "your kids like", partner: "your partner likes", friends: "your friends like" };

/**
 * What Wanees understood from this message, said back once in a short clause («سجّلت إن ولدك يحب
 * الطيران وإن أصغر طفل عمره 6 سنين»). Only facts the message changed; never the whole profile.
 */
export function notedFacts(changed: readonly string[], understood: Understanding, preferences: { youngestChildAge: number | null; partySize: number | null }, language: ReplyLanguage) {
  const en = language !== "ar";
  const parts: string[] = [];
  for (const like of understood.likes.slice(0, 2)) {
    parts.push(en ? `${WHO_PHRASE_EN[like.who]} ${like.tag === "طيران" ? "aviation" : like.tag}` : `${WHO_PHRASE_AR[like.who]} ${/^ال/.test(like.tag) || like.tag.includes(" ") ? like.tag : `ال${like.tag}`}`);
  }
  if (changed.includes("youngestChildAge") && preferences.youngestChildAge != null) {
    parts.push(en ? `your youngest is ${preferences.youngestChildAge}` : `إن أصغر طفل عمره ${preferences.youngestChildAge}`);
  }
  if (understood.avoidTags.length) parts.push(en ? `no ${understood.avoidTags.join(", ")}` : `بدون ${understood.avoidTags.join(" و")}`);
  if (understood.mobility) parts.push(en ? (understood.mobility === "wheelchair" ? "a wheelchair-friendly route" : "a stroller-friendly route") : (understood.mobility === "wheelchair" ? "إنكم تحتاجون طريق يناسب الكرسي" : "إن معكم عربية أطفال"));
  if (!parts.length) return "";
  return en ? `Noted: ${parts.join(", ")}.` : `سجّلت ${parts.join(" و")}.`;
}
