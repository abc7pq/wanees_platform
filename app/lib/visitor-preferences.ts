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
 * A remembered guest's taste (GET /api/v1/guest) back into session preferences for «نفس الجو»
 * (audit 4.1). Unknown or malformed fields are dropped; the visit length falls back to three hours.
 */
export function preferencesFromSnapshot(snapshot: Record<string, unknown> | null | undefined): BrowserVisitorPreferences {
  const source = snapshot ?? {};
  const text = (value: unknown) => (typeof value === "string" ? value.slice(0, 40) : null);
  const whole = (value: unknown, min: number, max: number) =>
    typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : null;
  return buildBrowserVisitorPreferences({
    companions: text(source.companions),
    partySize: whole(source.partySize, 1, 20),
    youngestChildAge: whole(source.youngestChildAge, 0, 17),
    mood: text(source.mood),
    interests: Array.isArray(source.interests) ? source.interests.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 40)).slice(0, 12) : [],
    budgetMaxCents: whole(source.budgetMaxCents, 0, 100_000_000),
    availableMinutes: whole(source.availableMinutes, 10, 24 * 60) ?? 180,
    optInPersist: false,
  });
}

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
