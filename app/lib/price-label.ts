// Price labels for itinerary stops. Engine prices are per person; the visitor's budget is for the group,
// so every paid stop says «للشخص» and, for a group, also shows what the stop costs the whole party.
// Pure helper (no DOM, no React) with Western digits, as in the rest of the visitor app.
import { AR_PERSON, arCount } from "./ar-count.ts";

export const FREE_LABEL = "مجانًا";

/** «لشخصين»، «لـ3 أشخاص»، «لـ12 شخصًا» — who a group price is for. */
export function forParty(partySize: number): string {
  return partySize === 2 ? `ل${AR_PERSON.two}` : `لـ${arCount(partySize, AR_PERSON)}`;
}

/** Party size used for prices: a whole number from 1 to 50, otherwise 1 (per person only). */
function normalizedParty(partySize: number | null | undefined): number {
  return Number.isInteger(partySize) && (partySize as number) >= 1 && (partySize as number) <= 50 ? (partySize as number) : 1;
}

export type StopPriceLabel = {
  /** «40 ريال للشخص» or «مجانًا». */
  perPerson: string;
  /** «120 ريال لـ3 أشخاص» when the party is larger than one and the stop is paid; otherwise null. */
  group: string | null;
};

/** Label for one stop's price (SAR per person) for a party of `partySize`. */
export function stopPriceLabel(pricePerPerson: number, partySize?: number | null): StopPriceLabel {
  if (!Number.isFinite(pricePerPerson) || pricePerPerson <= 0) return { perPerson: FREE_LABEL, group: null };
  const party = normalizedParty(partySize);
  return {
    perPerson: `${pricePerPerson} ريال للشخص`,
    group: party > 1 ? `${pricePerPerson * party} ريال ${forParty(party)}` : null,
  };
}
