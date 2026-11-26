const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670]/g;

/** Shared Arabic/English normalization for intent and catalog lookup. */
export function normalizeArabicText(value: string) {
  return value
    .toLocaleLowerCase("ar-SA")
    .normalize("NFKD")
    .replace(ARABIC_DIACRITICS, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ـ/g, "")
    .replace(/[،,؛;.!؟?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const LOCATION_PHRASES = [
  "وين",
  "اين",
  "كيف اوصل",
  "وين اوصل",
  "دلني علي",
  "ودني",
  "وديني",
  "كيف اروح",
  "وين اروح ل",
  "خذني ل",
  "دلني ع",
  "اتجاهات",
  "directions to",
  "دوره مياه",
  "دوره المياه",
  "دورات مياه",
  "دورات المياه",
  "حمام",
  "حمامات",
  "اسعاف",
  "عياده",
  "بوابه",
  "مخرج",
  "معلومات",
  "موقع",
  "where is",
  "location",
];

export function containsLocationPhrase(value: string) {
  const normalized = normalizeArabicText(value);
  return LOCATION_PHRASES.some((phrase) => normalized.includes(phrase));
}
