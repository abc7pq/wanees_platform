import { PITCH_EVENT_SLUG, PITCH_ORGANIZATION_SLUG } from "../../contracts/src/index.ts";
import type { Activity, Catalog, Schedule, Zone, Location, RouteGraph } from "./types.ts";
import { prisma } from "./prisma.ts";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function numberOr(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function minuteInTimezone(date: Date, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
    const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
    return Math.min(1439, Math.max(0, hour * 60 + minute));
  } catch {
    return (date.getUTCHours() * 60 + date.getUTCMinutes() + 180) % 1440;
  }
}

function scheduleForRows(rows: Array<{ kind: string; startsAt: Date; endsAt: Date }>, duration: number, timezone: string): Schedule {
  const ordered = [...rows].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  if (ordered.some((row) => row.kind === "slots") || ordered.length > 1) {
    return { type: "slots", slots: ordered.map((row) => minuteInTimezone(row.startsAt, timezone)) };
  }
  const first = ordered[0];
  if (!first) return { type: "continuous", from: 1020, to: 1400 };
  const from = minuteInTimezone(first.startsAt, timezone);
  const end = minuteInTimezone(first.endsAt, timezone);
  return {
    type: "continuous",
    from,
    to: end > from ? end : first.endsAt > first.startsAt ? end + 1440 : from + duration,
  };
}

function siteConfig(name: string, raw: unknown): Catalog["site"] {
  const config = record(raw);
  const opening = record(config.opening);
  const curve = record(config.base_crowd_curve);
  return {
    name,
    walking_speed_m_per_min: numberOr(config.walking_speed_m_per_min, 65),
    min_walk_min: numberOr(config.min_walk_min, 4),
    opening: {
      from: numberOr(opening.from, 1020),
      to: numberOr(opening.to, 1440),
    },
    crowd_threshold: numberOr(config.crowd_threshold, 0.75),
    base_crowd_curve: Object.fromEntries(
      Object.entries(curve).map(([key, value]) => [key, numberOr(value, 0.25)]),
    ),
    ...entryTicket(config.entry_ticket),
  };
}

function entryTicket(raw: unknown): { entry_ticket?: Catalog["site"]["entry_ticket"] } {
  const ticket = record(raw);
  if (typeof ticket.price !== "number" || typeof ticket.url !== "string" || typeof ticket.checked !== "string") return {};
  return { entry_ticket: { price: ticket.price, url: ticket.url, checked: ticket.checked } };
}

// The published catalog is immutable between republishes; re-querying and re-mapping it on
// every `/live` request saturates the single-threaded Node loop (head-of-line blocking) under
// concurrency. Memoize the parsed result per slug with a short TTL so the hot path is O(1).
const CATALOG_TTL_MS = 30_000;
const catalogCache = new Map<string, { value: Awaited<ReturnType<typeof loadCatalogFresh>>; expiresAt: number }>();
const catalogInFlight = new Map<string, Promise<Awaited<ReturnType<typeof loadCatalogFresh>>>>();

export async function loadPublishedEventCatalog(eventSlug: string) {
  const now = Date.now();
  const hit = catalogCache.get(eventSlug);
  if (hit && hit.expiresAt > now) return hit.value;

  // Single-flight: under a burst every concurrent caller misses the TTL cache and would
  // otherwise re-run the heavy query + mapping in parallel (cache stampede). Coalesce them
  // onto one in-flight promise so only one load happens per slug at a time.
  const existing = catalogInFlight.get(eventSlug);
  if (existing) return existing;

  const pending = loadCatalogFresh(eventSlug).then(
    (value) => {
      catalogInFlight.delete(eventSlug);
      if (value) catalogCache.set(eventSlug, { value, expiresAt: Date.now() + CATALOG_TTL_MS });
      return value;
    },
    (error) => {
      catalogInFlight.delete(eventSlug);
      throw error;
    },
  );
  catalogInFlight.set(eventSlug, pending);
  return pending;
}

const VERSION_INCLUDE = {
  zones: true,
  activities: { include: { schedules: true } },
  routeNodes: true,
  routeEdges: { include: { fromNode: true, toNode: true } },
  contentSources: true,
} as const;

// A superseded catalog version never changes again, so sessions pinned to it can share one parsed copy.
const PINNED_TTL_MS = 5 * 60_000;
const pinnedCache = new Map<string, { value: CatalogLoad; expiresAt: number }>();
type CatalogLoad = ReturnType<typeof mapCatalog> | null;

/**
 * Catalog for a visitor session. A session stays on the catalog version it started on
 * (docs/PRODUCT_PLATFORM_PLAN.md), so republishing a catalog does not break visits in progress.
 * Returns null when the event is no longer published or the version was never published for it.
 */
export async function loadSessionCatalog(eventSlug: string, catalogVersionId: string) {
  const published = await loadPublishedEventCatalog(eventSlug);
  if (!published || published.catalogVersionId === catalogVersionId) return published;
  const hit = pinnedCache.get(catalogVersionId);
  if (hit && hit.expiresAt > Date.now() && hit.value?.eventId === published.eventId) return hit.value;
  try {
    const version = await prisma.catalogVersion.findFirst({
      where: { id: catalogVersionId, eventId: published.eventId, status: { in: ["PUBLISHED", "SUPERSEDED"] as any }, publishedAt: { not: null } },
      include: { ...VERSION_INCLUDE, event: { include: { venue: true } } },
    });
    if (!version) return null;
    const value = mapCatalog(version.event, version);
    if (pinnedCache.size > 50) pinnedCache.clear();
    pinnedCache.set(catalogVersionId, { value, expiresAt: Date.now() + PINNED_TTL_MS });
    return value;
  } catch (error) {
    if (process.env.NODE_ENV !== "production") console.warn("WANEES pinned catalog unavailable.", error);
    return null;
  }
}

async function loadCatalogFresh(eventSlug: string) {
  if (!process.env.DATABASE_URL) return null;

  try {
    const event = await prisma.event.findFirst({
      where: {
        slug: eventSlug,
        ...(eventSlug === PITCH_EVENT_SLUG ? { organization: { slug: PITCH_ORGANIZATION_SLUG } } : {}),
        status: { in: ["PUBLISHED", "LIVE"] as any },
        publishedCatalogVersionId: { not: null },
      },
      include: {
        venue: true,
        publishedCatalogVersion: { include: VERSION_INCLUDE },
      },
    });

    const version = event?.publishedCatalogVersion;
    if (!event || !version) return null;
    return mapCatalog(event, version);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("WANEES database catalog unavailable; caller may use the JSON fixture.", error);
    }
    return null;
  }
}

type CatalogEventRow = NonNullable<Awaited<ReturnType<typeof findEventWithVersion>>>;
type CatalogVersionRow = NonNullable<CatalogEventRow["publishedCatalogVersion"]>;

// Only used for its type: the event row with its venue and a fully included catalog version.
function findEventWithVersion() {
  return prisma.event.findFirst({ include: { venue: true, publishedCatalogVersion: { include: VERSION_INCLUDE } } });
}

function mapCatalog(event: Omit<CatalogEventRow, "publishedCatalogVersion">, version: CatalogVersionRow) {
  const zoneById = new Map(version.zones.map((zone) => [zone.id, zone]));
  const zones: Zone[] = version.zones.map((zone) => ({
    id: zone.stableKey,
    name: zone.nameAr,
    x: zone.mapX,
    y: zone.mapY,
    popularity: zone.popularityWeight,
  }));
  const timezone = event.venue?.timezone ?? "Asia/Riyadh";
  const priceSources = new Map(version.contentSources
    .filter((source) => source.sourceType === "official_ticketing" && source.reviewStatus === "VERIFIED" && source.locator)
    .map((source) => [source.id, { url: source.locator!, title: source.title, checked: (source.observedAt ?? new Date()).toISOString().slice(0, 10) }]));
  const activities: Activity[] = version.activities.filter((activity) => activity.status === "ACTIVE").map((activity) => {
    const zone = zoneById.get(activity.zoneId);
    return {
      id: activity.stableKey,
      name: activity.nameAr,
      name_en: activity.nameEn ?? undefined,
      zone: zone?.stableKey ?? "unknown",
      type: activity.type,
      duration_min: activity.durationMin,
      price: (activity.priceMaxCents ?? activity.priceMinCents ?? 0) / 100,
      price_known: activity.priceMinCents !== null,
      price_source: activity.sourceRefs.map((ref) => priceSources.get(ref)).find(Boolean),
      eligibility_known: activity.reviewStatus === "VERIFIED",
      family: activity.familyFriendly,
      min_age: activity.ageMin ?? undefined,
      interests: activity.interests,
      moods: activity.moods,
      popularity: activity.popularityWeight,
      schedule: scheduleForRows(activity.schedules, activity.durationMin, timezone),
    };
  });
  const locations: Location[] = version.routeNodes.map((node) => ({
    id: node.stableKey,
    label: node.label,
    type: node.type,
    zone: zoneById.get(node.zoneId ?? "")?.stableKey,
    x: node.x,
    y: node.y,
    accessible: node.accessible,
    status: node.status,
    description: node.description ?? undefined,
    aliases: node.aliases,
    sourceRef: `catalog:${version.id}/route-node:${node.stableKey}`,
  }));
  const routeGraph: RouteGraph = {
    nodes: version.routeNodes.map((node) => ({
      id: node.stableKey,
      type: node.type,
      label: node.label,
      zone: zoneById.get(node.zoneId ?? "")?.stableKey,
      x: node.x,
      y: node.y,
      accessible: node.accessible,
      status: node.status,
    })),
    edges: version.routeEdges.map((edge) => ({
      from: edge.fromNode.stableKey,
      to: edge.toNode.stableKey,
      distanceM: edge.distanceM,
      walkMin: edge.walkMin,
      accessible: edge.accessible,
      status: edge.status,
    })),
  };
  const source = version.contentSources[0];

  return {
    eventId: event.id,
    eventSlug: event.slug,
    eventName: event.name,
    eventStatus: event.status,
    eventStartsAt: event.startsAt,
    eventEndsAt: event.endsAt,
    venueTimezone: event.venue?.timezone ?? "Asia/Riyadh",
    catalogVersionId: version.id,
    demoNavigation: record(version.validationReport).source === "json-fixture" || version.contentSources.some((entry) => entry.sourceType === "fixture"),
    activityDbIds: Object.fromEntries(version.activities.map((activity) => [activity.stableKey, activity.id])),
    catalog: {
      meta: {
        source: source?.title ?? version.sourceSummary ?? "WANEES database catalog",
        note: "Loaded from the published WANEES catalog version.",
        currency: "SAR",
      },
      site: siteConfig(event.name, version.config),
      zones,
      activities,
      locations,
      routeGraph,
    } satisfies Catalog,
  };
}
