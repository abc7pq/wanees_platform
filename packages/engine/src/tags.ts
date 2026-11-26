// The controlled tag vocabulary (audit item 1.3). An event's activities carry tags from this list;
// the visitor's own words map onto the same tags (item 1.1), so «ولدي يحب الطيارات» and an
// activity tagged «طيران» meet without the model ever inventing an interest.
//
// Each tag has an Arabic label (the key stored on activities and profiles), an English label and
// the words that mean it in Saudi dialect, Modern Standard Arabic and English. Words are matched
// after `normalizeTagText` (no diacritics, ا/أ/إ → ا, ة → ه, ى → ي, lower case).

export type TagDefinition = {
  /** Arabic label; the key stored on activities and visitor profiles. */
  tag: string;
  en: string;
  words: readonly string[];
  /** Content that is never offered while a visitor's party is unknown or has children (item 1.2). */
  sensitive?: boolean;
};

export const TAG_LEXICON: readonly TagDefinition[] = [
  { tag: "طيران", en: "aviation", words: ["طيران", "طياره", "طيارات", "طائره", "طائرات", "طيار", "تحليق", "مظلات", "aviation", "plane", "planes", "airplane", "flying", "flight", "pilot"] },
  { tag: "حيوانات", en: "animals", words: ["حيوان", "حيوانات", "زرافه", "زرافات", "اسود", "اسد", "دلافين", "دولفين", "دلفين", "طيور", "قرود", "زواحف", "سحالي", "فيل", "animal", "animals", "zoo", "dolphin", "dolphins", "giraffe", "lion", "birds"] },
  { tag: "سيارات", en: "cars", words: ["سيارات", "سياره", "سباق", "سباقات", "درفت", "تفحيط", "كارتينج", "قو كارت", "cars", "racing", "race", "karting", "drift"] },
  { tag: "أنمي", en: "anime", words: ["انمي", "أنمي", "مانجا", "كرتون", "anime", "manga", "cartoon"] },
  { tag: "كورة", en: "football", words: ["كوره", "كرة القدم", "كره القدم", "كرة قدم", "كره قدم", "فوتبول", "مباراه", "ملعب", "football", "soccer"] },
  { tag: "رياضة", en: "sports", words: ["رياضه", "رياضي", "رياضات", "سله", "بولينج", "تسلق", "sport", "sports", "bowling", "climbing"] },
  { tag: "تاريخ", en: "history", words: ["تاريخ", "تاريخي", "تاريخيه", "اثار", "حضاره", "حضارات", "تراث", "فراعنه", "قديم", "history", "historic", "heritage", "ancient", "museum"] },
  { tag: "ثقافة", en: "culture", words: ["ثقافه", "ثقافات", "ثقافي", "شعوب", "دول", "culture", "cultural", "countries"] },
  { tag: "رعب", en: "horror", words: ["رعب", "مرعب", "مرعبه", "خوف", "يخوف", "بيت الرعب", "زومبي", "اشباح", "horror", "scary", "haunted", "zombie", "fear"], sensitive: true },
  { tag: "ماء", en: "water", words: ["ماء", "مويه", "موية", "بحيره", "قارب", "قوارب", "بحر", "غوص", "water", "boat", "boats", "lake", "splash"] },
  { tag: "إثارة", en: "thrills", words: ["اثاره", "ادرينالين", "مغامره", "مغامرات", "افعوانيه", "قطار الموت", "سرعه", "مرتفعات", "اكشن", "thrill", "thrills", "adrenaline", "adventure", "roller coaster", "coaster", "action", "extreme"] },
  { tag: "ألعاب", en: "games", words: ["العاب", "لعبه", "اركيد", "تحدي", "مسابقات", "game", "games", "arcade", "challenge"] },
  { tag: "رماية", en: "shooting", words: ["رمايه", "تصويب", "شوتنج", "ليزر تاق", "بينت بول", "shooting", "laser tag", "paintball", "archery"] },
  { tag: "واقع افتراضي", en: "virtual reality", words: ["واقع افتراضي", "في ار", "نظارات", "ميتافيرس", "vr", "virtual reality", "metaverse"] },
  { tag: "عروض", en: "shows", words: ["عرض", "عروض", "مسرح", "مسرحيه", "استعراض", "سيرك", "فرقه", "show", "shows", "performance", "theatre", "theater", "circus", "parade"] },
  { tag: "موسيقى", en: "music", words: ["موسيقى", "موسيقي", "اغاني", "حفله", "حفلات", "طرب", "دي جي", "music", "concert", "live music", "dj"] },
  { tag: "أكل", en: "food", words: ["اكل", "مطعم", "مطاعم", "جوعان", "جوعانين", "عشاء", "غداء", "وجبه", "قهوه", "كوفي", "حلا", "حلويات", "سناك", "food", "eat", "restaurant", "restaurants", "dinner", "hungry", "coffee", "dessert", "snack"] },
  { tag: "تسوق", en: "shopping", words: ["تسوق", "تسوّق", "محلات", "سوق", "اسواق", "هدايا", "تذكار", "shopping", "shop", "shops", "souvenir", "market"] },
  { tag: "تصوير", en: "photos", words: ["تصوير", "صور", "اتصور", "انستقرام", "سناب", "photo", "photos", "pictures", "instagram"] },
  { tag: "أطفال", en: "kids", words: ["اطفال", "للاطفال", "صغار", "بزران", "kids", "children", "toddlers"] },
  { tag: "هدوء", en: "calm", words: ["هادي", "هادئ", "هدوء", "رايق", "استرخاء", "calm", "quiet", "relax", "relaxing", "chill"] },
] as const;

const TAG_BY_LABEL = new Map(TAG_LEXICON.map((definition) => [definition.tag, definition]));

export function normalizeTagText(value: string) {
  return value
    .toLocaleLowerCase("ar-SA")
    .normalize("NFKD")
    .replace(/[ً-ٰٟ]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ـ/g, "")
    .replace(/[،,؛;.!؟?«»"'()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const PREFIXES = ["", "ال", "و", "وال", "ب", "بال", "لل", "ل", "ف", "فال"];

/** True when the normalized text contains the word as a whole word, allowing Arabic prefixes. */
function hasWord(text: string, word: string) {
  const needle = normalizeTagText(word);
  if (!needle) return false;
  if (/^[a-z ]+$/.test(needle)) return new RegExp(`(^| )${needle.replace(/ /g, " ")}s?($| )`).test(text);
  return PREFIXES.some((prefix) => ` ${text} `.includes(` ${prefix}${needle} `)
    || ` ${text} `.includes(` ${prefix}${needle}ين `)
    || ` ${text} `.includes(` ${prefix}${needle}ات `));
}

/** Tags whose words appear in the text, in lexicon order. */
export function tagsInText(text: string): string[] {
  const value = normalizeTagText(text);
  return TAG_LEXICON.filter((definition) => definition.words.some((word) => hasWord(value, word))).map((definition) => definition.tag);
}

export function tagDefinition(tag: string) {
  return TAG_BY_LABEL.get(tag);
}

export function isKnownTag(tag: string) {
  return TAG_BY_LABEL.has(tag);
}

export function isSensitiveTag(tag: string) {
  return TAG_BY_LABEL.get(tag)?.sensitive === true;
}

/** English label for a tag (for replies in English), or the tag itself. */
export function tagLabel(tag: string, language: "ar" | "en" = "ar") {
  return language === "en" ? TAG_BY_LABEL.get(tag)?.en ?? tag : tag;
}
