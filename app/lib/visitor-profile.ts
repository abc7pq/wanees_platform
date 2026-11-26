import type { Catalog, Profile } from "@/engine/types.ts";
import { decodeLikes } from "./visitor-understanding.ts";

type PreferenceInput = {
  companions?: string | null;
  partySize?: number | null;
  youngestChildAge?: number | null;
  mood?: string | null;
  interests?: string[] | null;
  budgetMaxCents?: number | null;
  availableMinutes?: number | null;
  walkingTolerance?: string | null;
  startPointId?: string | null;
  startMinute?: number | null;
  /** Understood from conversation (audit item 1.1). */
  childAges?: number[] | null;
  likes?: string[] | null;
  avoidTags?: string[] | null;
  mobility?: string | null;
};

function openingMinute(catalog: Catalog) {
  const opening = catalog.site.opening.from;
  return opening < 100 ? opening * 60 : opening;
}

function closingMinute(catalog: Catalog) {
  const closing = catalog.site.opening.to;
  return closing < 100 ? closing * 60 : closing;
}

// عتبة الحد الأدنى للخطة الليلة: تحت هذا المتبقي، ننتقل تلقائيًا إلى افتتاحية اليوم التالي
// بقية مدة الزيارة الكاملة بدل إعادة مسار فارغ (سلوك حتمي موثق في الاختبارات).
const MINIMUM_VIABLE_REMAINING_MIN = 30;

function hasChildren(companions: string | null | undefined) {
  return Boolean(companions && /family|child|kid|أطفال|طفل|عائلة|عائله/i.test(companions));
}

function adultCount(companions: string | null | undefined) {
  if (!companions) return 1;
  if (/solo|فردي|لحالي/i.test(companions)) return 1;
  if (/couple|زوج|شخصين|اثنين/i.test(companions)) return 2;
  return 2;
}

export function profileFromPreferences(catalog: Catalog, input: PreferenceInput | null | undefined, startMinuteOverride?: number): Profile {
  return resolveVisitWindow(catalog, input, startMinuteOverride).profile;
}

// يحل نافذة الزيارة ودقيقة «الآن» الفعالة معًا (سياسة حتمية):
// - متبقٍ ≥ 30 دقيقة: خطّط الليلة حتى الإغلاق (المدة مقصوصة على المتبقي)، و«الآن» كما هو.
// - متبقٍ < 30 دقيقة: انتقل لافتتاحية اليوم التالي بمدة كاملة، و«الآن» ينتقل مع النافذة
//   حتى تعامل المحطات كقادمة (إعادة التخطيط/الإغلاق العاجل تعمل صحيحًا في أي ساعة).
export function resolveVisitWindow(catalog: Catalog, input: PreferenceInput | null | undefined, startMinuteOverride?: number): { profile: Profile; effectiveNowMinute: number; rolled: boolean } {
  const closing = closingMinute(catalog);
  const opening = openingMinute(catalog);
  const rawStart = input?.startMinute ?? startMinuteOverride ?? opening;
  const requestedDuration = input?.availableMinutes ?? 180;
  const remainingTonight = closing - rawStart;
  const rolled = remainingTonight < MINIMUM_VIABLE_REMAINING_MIN;
  const startMin = rolled ? opening : rawStart;
  const durationMin = rolled
    ? requestedDuration
    : Math.min(requestedDuration, Math.max(remainingTonight, 1));
  const requestedStart = input?.startPointId;
  const requestedLocation = requestedStart ? catalog.locations?.find((location) => location.id === requestedStart) : undefined;
  const startZone = requestedStart && catalog.zones.some((zone) => zone.id === requestedStart)
    ? requestedStart
    : requestedLocation?.zone && catalog.zones.some((zone) => zone.id === requestedLocation.zone)
      ? requestedLocation.zone
      : catalog.zones[0]?.id ?? "";

  const profile: Profile = {
    mood: input?.mood ?? undefined,
    budget: input?.budgetMaxCents == null ? null : Math.floor(input.budgetMaxCents / 100),
    companions_kids: hasChildren(input?.companions) || input?.youngestChildAge != null,
    companions_adults: adultCount(input?.companions),
    party_size: input?.partySize ?? undefined,
    youngest_child_age: input?.youngestChildAge ?? null,
    interests: input?.interests ?? [],
    start_min: startMin,
    duration_min: durationMin,
    start_zone: startZone,
    must_include: [],
    avoid: [],
    likes: decodeLikes(input?.likes),
    // Safe defaults while the party is unknown (audit item 1.2): no age-limited or horror items,
    // mid-priced activities first when no budget was given.
    cautious: !input?.companions && input?.youngestChildAge == null && !(input?.childAges?.length),
    prefer_mid_price: input?.budgetMaxCents == null,
    avoid_tags: input?.avoidTags ?? [],
    mobility: input?.mobility === "wheelchair" || input?.mobility === "stroller" ? input.mobility : null,
  };
  return { profile, effectiveNowMinute: rolled ? startMin : rawStart, rolled };
}

/**
 * «Now» during a visit in progress. The stored visit start never moves forward, so take the event
 * clock whenever it falls inside the visit window; otherwise a stop that is under way or already
 * finished would be treated as still to come when the visitor changes the plan.
 * A visit rolled to the next opening keeps its start.
 */
export function visitNowMinute(visit: { profile: Profile; effectiveNowMinute: number; rolled: boolean }, clockNowMinute: number) {
  if (visit.rolled) return visit.effectiveNowMinute;
  const end = visit.profile.start_min + visit.profile.duration_min;
  return clockNowMinute > visit.effectiveNowMinute && clockNowMinute <= end ? clockNowMinute : visit.effectiveNowMinute;
}
