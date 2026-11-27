// Arabic counted-noun agreement for visitor and operator text: «دقيقة / دقيقتين / ٣ دقائق / ١١ دقيقة».
// Pure helper (no DOM, no React) so both the visitor app and the ops pages can share it.

export type ArNoun = {
  /** 1 — the noun with «واحد/واحدة», or the bare noun when that reads better (دقيقة). */
  one: string;
  /** 2 — the dual (شخصين، دقيقتين). */
  two: string;
  /** 3–10 — broken/sound plural (أشخاص، دقائق). */
  plural: string;
  /** 11–99 — singular accusative (شخصًا، دقيقة). */
  accusative: string;
  /** 100, 200… (and x01/x02) — singular genitive (شخص، دقيقة). */
  singular: string;
};

export const AR_PERSON: ArNoun = { one: "شخص واحد", two: "شخصين", plural: "أشخاص", accusative: "شخصًا", singular: "شخص" };
export const AR_MINUTE: ArNoun = { one: "دقيقة", two: "دقيقتين", plural: "دقائق", accusative: "دقيقة", singular: "دقيقة" };
export const AR_ATTEMPT: ArNoun = { one: "محاولة واحدة", two: "محاولتين", plural: "محاولات", accusative: "محاولة", singular: "محاولة" };
export const AR_STOP: ArNoun = { one: "توقف واحد", two: "توقفان", plural: "توقفات", accusative: "توقفًا", singular: "توقف" };
/** An itinerary stop («محطة واحدة / محطتين / 3 محطات / 11 محطة»). */
export const AR_STATION: ArNoun = { one: "محطة واحدة", two: "محطتين", plural: "محطات", accusative: "محطة", singular: "محطة" };
/** «دقيقة واحدة» when a sentence needs the explicit one (durations, walks). */
export const AR_MINUTE_EXPLICIT: ArNoun = { ...AR_MINUTE, one: "دقيقة واحدة" };

export const AR_HOUR: ArNoun = { one: "ساعة", two: "ساعتين", plural: "ساعات", accusative: "ساعة", singular: "ساعة" };

/** A visit length in hours, to the nearest half: «نص ساعة»، «ساعة»، «ساعة ونص»، «ساعتين»، «3 ساعات ونص»، «12 ساعة». */
export function hoursCount(minutes: number, format: (value: number) => string = String) {
  const halves = Math.max(1, Math.round(minutes / 30));
  const whole = Math.floor(halves / 2);
  const half = halves % 2 === 1;
  if (whole === 0) return "نص ساعة";
  const base = arCount(whole, AR_HOUR, format);
  return half ? `${base} ونص` : base;
}

/** «دقيقة واحدة / دقيقتين / 3 دقائق / 11 دقيقة» for a minute count that may be fractional. */
export function minutesCount(value: number, format: (value: number) => string = String) {
  return arCount(Math.round(value), AR_MINUTE_EXPLICIT, format);
}

/** «محطة واحدة / محطتين / 3 محطات / 11 محطة». */
export function stationsCount(value: number, format: (value: number) => string = String) {
  return arCount(value, AR_STATION, format);
}

/** «شخص واحد / شخصين / 3 أشخاص / 11 شخصًا». */
export function peopleCount(value: number, format: (value: number) => string = String) {
  return arCount(value, AR_PERSON, format);
}

/** «شخص واحد»، «شخصين»، «3 أشخاص»، «11 شخصًا»، «100 شخص». `format` renders the number (e.g. Arabic-Indic digits). */
export function arCount(n: number, noun: ArNoun, format: (value: number) => string = String): string {
  if (n === 1) return noun.one;
  if (n === 2) return noun.two;
  const rest = Math.abs(n) % 100;
  if (rest >= 3 && rest <= 10) return `${format(n)} ${noun.plural}`;
  if (Math.abs(n) >= 100 && rest <= 2) return `${format(n)} ${noun.singular}`;
  return `${format(n)} ${noun.accusative}`;
}
