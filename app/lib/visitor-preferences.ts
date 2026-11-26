export type BrowserVisitorPreferencesInput = {
  companions?: string | null;
  partySize?: number | null;
  youngestChildAge?: number | null;
  mood?: string | null;
  interests?: readonly string[] | null;
  budgetMaxCents: number | null;
  availableMinutes: number;
  optInPersist: boolean;
  startPointId?: string | null;
};

export type BrowserVisitorPreferences = {
  companions?: string;
  partySize?: number;
  youngestChildAge?: number;
  mood?: string;
  interests: string[];
  budgetMaxCents: number | null;
  availableMinutes: number;
  optInPersist: boolean;
  startPointId?: string;
};

/**
 * Keep optional text fields out of API payloads when the quiz or a saved guest
 * profile does not provide a value. The API intentionally rejects blank text.
 */
export function buildBrowserVisitorPreferences(input: BrowserVisitorPreferencesInput): BrowserVisitorPreferences {
  const companions = input.companions?.trim();
  const mood = input.mood?.trim();
  const startPointId = input.startPointId?.trim();
  const interests = (input.interests ?? [])
    .map((interest) => interest.trim())
    .filter(Boolean);

  return {
    ...(companions ? { companions } : {}),
    ...(input.partySize != null ? { partySize: input.partySize } : {}),
    ...(input.youngestChildAge != null ? { youngestChildAge: input.youngestChildAge } : {}),
    ...(mood ? { mood } : {}),
    interests,
    budgetMaxCents: input.budgetMaxCents,
    availableMinutes: input.availableMinutes,
    optInPersist: input.optInPersist,
    ...(startPointId ? { startPointId } : {}),
  };
}
