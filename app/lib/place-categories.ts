// Place categories (audit items 1.5 and 3.2). «ابي مطعم», «وين المطاعم», «أقرب دورة مياه» name a
// category, not a place. The category is a hard filter applied before any ranking, so a food
// request can never come back as a giraffe experience or a prayer room. Members come from the
// published catalog only (activities by type or tag, route nodes by label and alias), and «nearest»
// is ranked by real walking minutes over the published walkway graph.
import type { Site } from "../engine/site.ts";
import type { Activity, Location } from "../engine/types.ts";
import { normalizeTagText } from "../../packages/engine/src/tags.ts";

export type PlaceCategory = "food" | "toilets" | "prayer" | "first_aid" | "info" | "seating" | "gate" | "parking" | "shopping" | "shows";

type CategoryDefinition = {
  category: PlaceCategory;
  labelAr: string;
  labelEn: string;
  words: readonly string[];
  /** Activities in the category, by type or controlled tag. */
  activityTypes?: readonly string[];
  activityTags?: readonly string[];
  /** Route nodes in the category, by words in their label or aliases. */
  nodeWords?: readonly string[];
  nodeTypes?: readonly string[];
};

export const PLACE_CATEGORIES: readonly CategoryDefinition[] = [
  { category: "toilets", labelAr: "دورات المياه", labelEn: "restrooms", words: ["دوره مياه", "دورات مياه", "دوره المياه", "دورات المياه", "حمام", "حمامات", "الحمام", "الحمامات", "توليت", "toilet", "toilets", "restroom", "restrooms", "bathroom", "wc"], nodeWords: ["دوره مياه", "دورات المياه", "دورات مياه", "حمام", "toilet", "restroom"] },
  { category: "prayer", labelAr: "المصليات", labelEn: "prayer rooms", words: ["مصلى", "مصلي", "مصليات", "المصلى", "مسجد", "اصلي", "صلاه", "prayer", "prayer room", "mosque", "pray"], nodeWords: ["مصلى", "مصلي", "مسجد", "prayer"] },
  { category: "first_aid", labelAr: "الإسعاف", labelEn: "first aid", words: ["اسعاف", "الاسعاف", "عياده", "ممرض", "طبيب", "first aid", "medic", "medical", "clinic", "nurse"], nodeWords: ["اسعاف", "عياده", "ممرض", "first aid", "medical"] },
  { category: "info", labelAr: "نقاط المعلومات", labelEn: "information desks", words: ["معلومات", "استعلامات", "مكتب المعلومات", "نقطه المعلومات", "info", "information", "help desk", "information desk"], nodeWords: ["معلومات", "استعلامات", "information"] },
  { category: "gate", labelAr: "البوابات", labelEn: "gates", words: ["بوابه", "البوابه", "بوابات", "مخرج", "المخرج", "مخارج", "مدخل", "المدخل", "gate", "gates", "exit", "entrance"], nodeTypes: ["ENTRANCE"] },
  { category: "parking", labelAr: "المواقف", labelEn: "parking", words: ["مواقف", "موقف", "باركنق", "parking", "car park"], nodeWords: ["مواقف", "parking"] },
  { category: "seating", labelAr: "أماكن الجلوس", labelEn: "seating", words: ["مكان اجلس", "مكان نجلس", "مكان اقعد", "مكان نقعد", "جلسه", "جلسات", "كراسي", "استراحه", "seating", "seats", "bench", "benches", "sit down", "place to sit"], nodeWords: ["جلسات", "جلسه", "استراحه", "seating"] },
  { category: "food", labelAr: "المطاعم", labelEn: "restaurants", words: ["مطعم", "مطاعم", "المطعم", "المطاعم", "اكل", "الاكل", "ناكل", "اكلات", "جوعان", "جوعانين", "عشاء", "غداء", "كوفي", "قهوه", "كافيه", "مقهى", "حلا", "restaurant", "restaurants", "food", "eat", "dinner", "lunch", "hungry", "coffee", "cafe", "café"], activityTypes: ["food"], activityTags: ["أكل"], nodeWords: ["مطعم", "مطاعم", "food court"] },
  { category: "shopping", labelAr: "المحلات", labelEn: "shops", words: ["محل", "محلات", "تسوق", "سوق", "اسواق", "هدايا", "shop", "shops", "shopping", "souvenir", "souvenirs", "store"], activityTypes: ["shopping"], activityTags: ["تسوق"] },
  { category: "shows", labelAr: "العروض", labelEn: "shows", words: ["عرض", "عروض", "العرض", "العروض", "مسرح", "show", "shows", "performance", "parade"], activityTypes: ["show"], activityTags: ["عروض"] },
];

const BY_CATEGORY = new Map(PLACE_CATEGORIES.map((definition) => [definition.category, definition]));

const PREFIXES = ["", "ال", "و", "وال", "ب", "بال", "لل", "ل", "ف"];
function containsWord(text: string, word: string) {
  const needle = normalizeTagText(word);
  return PREFIXES.some((prefix) => ` ${text} `.includes(` ${prefix}${needle} `));
}

/** The category a message asks for, if any. Services win over activities («مطعم قريب من الحمام» → food is the target, handled by the target split). */
export function detectCategory(text: string): PlaceCategory | null {
  const value = normalizeTagText(text);
  for (const definition of PLACE_CATEGORIES) {
    if (definition.words.some((word) => containsWord(value, word))) return definition.category;
  }
  return null;
}

export function categoryLabel(category: PlaceCategory, language: "ar" | "en" = "ar") {
  const definition = BY_CATEGORY.get(category)!;
  return language === "en" ? definition.labelEn : definition.labelAr;
}

// ————— Origin and target in one message (item 1.5) —————
const ORIGIN_MARKERS = /(?:^| )(?:انا عند|انا في|انا جنب|انا قريب من|احنا عند|احنا في|احنا جنب|واقف عند|واقفين عند|موجود عند|موجود في|موجودين في|من عند|من|i m at|i am at|we re at|we are at|i m near|i am near|i m in|i am in|from|near)\s+(.+?)(?=(?: و?(?:دلني|دليني|وديني|ودني|ابي|ابغي|نبي|وين|كيف|اقرب|where|how|take me|show me|nearest|closest)| ?$))/;

/**
 * Splits «انا عند جناح افريقيا، دلني على المطاعم» into the place the visitor stands (origin text)
 * and the request (target text). Returns null when the message names no origin.
 */
export function splitOriginTarget(message: string): { originText: string; targetText: string } | null {
  const parts = message.split(/[،,.؛;\n]/).map((part) => part.trim()).filter(Boolean);
  for (let index = 0; index < parts.length; index++) {
    const value = normalizeTagText(parts[index]);
    const match = value.match(ORIGIN_MARKERS);
    if (!match || detectCategory(match[1]) && !/جناح|منطقه|zone|pavilion/.test(match[1])) continue;
    const rest = [value.slice(0, match.index ?? 0), value.slice((match.index ?? 0) + match[0].length), ...parts.slice(index + 1).map(normalizeTagText), ...parts.slice(0, index).map(normalizeTagText)]
      .join(" ").trim();
    return { originText: match[1].trim(), targetText: rest || value };
  }
  return null;
}

/** The zone a spoken origin names: «جناح افريقيا», «منطقة مصر», «عند الصين». */
export function zoneFromText(site: Site, text: string): string | null {
  const value = normalizeTagText(text).replace(/^(?:جناح|منطقه|قريه|ساحه|حي|pavilion|zone)\s+/, "");
  if (!value) return null;
  let best: { id: string; length: number } | null = null;
  for (const zone of site.zones.values()) {
    const names = [zone.name, zone.name.replace(/^(?:منطقة|قرية|ساحة|الحي)\s+/, ""), zone.id];
    for (const name of names) {
      const normalized = normalizeTagText(name);
      const bare = normalized.replace(/^ال/, "");
      if (normalized.length < 2) continue;
      const hit = ` ${value} `.includes(` ${normalized} `) || ` ${value} `.includes(` ${bare} `) || ` ${value} `.includes(` ال${bare} `)
        || normalized.includes(value) && value.length >= 3;
      if (hit && (!best || normalized.length > best.length)) best = { id: zone.id, length: normalized.length };
    }
  }
  return best?.id ?? null;
}

// ————— Members and nearest by walking (item 3.2) —————
/** The entrance node of an activity when its organizer set one and it is on the graph (audit 3.4). */
export function entranceOf(site: Site, activity: Activity) {
  return activity.entrance_node && site.routeGraphNodes.has(activity.entrance_node) ? activity.entrance_node : null;
}

export type CategoryMember = { kind: "activity"; activity: Activity; zone: string; nodeId: string | null } | { kind: "location"; location: Location; zone: string; nodeId: string | null };

export function categoryMembers(site: Site, category: PlaceCategory): CategoryMember[] {
  const definition = BY_CATEGORY.get(category)!;
  const members: CategoryMember[] = [];
  for (const activity of site.activities.values()) {
    const byType = definition.activityTypes?.includes(activity.type);
    const byTag = definition.activityTags?.some((tag) => activity.tags?.includes(tag) && (category !== "food" || activity.type === "food"));
    if ((byType || byTag) && activity.price_known !== false) members.push({ kind: "activity", activity, zone: activity.zone, nodeId: entranceOf(site, activity) });
  }
  for (const location of site.locations.values()) {
    if (location.status !== "open" || !location.zone) continue;
    const text = normalizeTagText([location.label, ...location.aliases].join(" "));
    const byType = definition.nodeTypes?.includes(location.type);
    const byWord = location.type !== "ZONE" && definition.nodeWords?.some((word) => containsWord(text, word));
    if (byType || byWord) members.push({ kind: "location", location, zone: location.zone, nodeId: site.routeGraphNodes.has(location.id) ? location.id : null });
  }
  return members;
}

export type NearbyPlace = { member: CategoryMember; id: string; name: string; zone: string; walkMin: number };

/** Up to `limit` members of a category, nearest first by walking minutes from the origin zone. */
export function nearestInCategory(site: Site, category: PlaceCategory, originZone: string | null, limit = 3): NearbyPlace[] {
  const members = categoryMembers(site, category);
  const ranked = members.map((member) => ({
    member,
    id: member.kind === "activity" ? member.activity.id : member.location.id,
    name: member.kind === "activity" ? member.activity.name : member.location.label,
    zone: member.zone,
    walkMin: originZone ? (member.zone === originZone ? 0 : site.travelMin(originZone, member.zone)) : 0,
  }));
  // Nearest first; at equal walking time the more popular activity, then the name, so ties are stable.
  ranked.sort((a, b) => a.walkMin - b.walkMin
    || ((b.member.kind === "activity" ? b.member.activity.popularity : 0) - (a.member.kind === "activity" ? a.member.activity.popularity : 0))
    || a.name.localeCompare(b.name, "ar"));
  return ranked.slice(0, limit);
}

// ————— Rest (audit 1.6) —————
const REST = /(?:^| )(?:تعبت|تعبنا|تعبان|تعبانه|تعبانين|رجولي|ابي ارتاح|نبي نرتاح|ابغي ارتاح|ابي اقعد|نبي نقعد|ابي اجلس|نبي نجلس|ابي استريح|i m tired|i am tired|we re tired|we are tired|need a rest|need to sit|want to sit)(?: |$)/;

/** «تعبت ابي اقعد»: the visitor wants to rest, not a seat category lookup. */
export function isRestRequest(text: string) {
  return REST.test(normalizeTagText(text));
}

/**
 * Where to rest when the event publishes no seating: the nearest calm activities (mood هادئ or the
 * هدوء tag), by walking minutes, cheaper first at equal distance. Never an invented bench.
 */
export function nearestCalm(site: Site, originZone: string | null, limit = 3): NearbyPlace[] {
  const calm = [...site.activities.values()].filter((activity) => (activity.moods.includes("هادئ") || activity.tags?.includes("هدوء")) && activity.price_known !== false);
  return calm
    .map((activity) => ({
      member: { kind: "activity", activity, zone: activity.zone, nodeId: entranceOf(site, activity) } as CategoryMember,
      id: activity.id,
      name: activity.name,
      zone: activity.zone,
      walkMin: originZone ? (activity.zone === originZone ? 0 : site.travelMin(originZone, activity.zone)) : 0,
      price: activity.price,
    }))
    .sort((a, b) => a.walkMin - b.walkMin || a.price - b.price || a.name.localeCompare(b.name, "ar"))
    .slice(0, limit)
    .map(({ price: _price, ...place }) => place);
}
