import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hashPassword } from "../admin/lib/password.ts";
import { PITCH_EVENT_SLUG, PITCH_ORGANIZATION_SLUG } from "../packages/contracts/src/index.ts";
import { loadProjectEnv } from "../scripts/load-project-env.ts";
import { prismaPgArgs } from "../packages/contracts/src/database.ts";
import { buildWalkwayEdges, nearestNodeKey } from "../packages/engine/src/walkway-graph.ts";
import { BOULEVARD_CENTER, BOULEVARD_GATES, BOULEVARD_LAGOON } from "../packages/engine/src/venue-geometry.ts";

// Audit item 1.3: descriptions, controlled tags and highlights travel with every seeded activity.
const SAMPLE_WORKSHOP_CONTENT = {
  descriptionAr: "ورشة ترحيبية قصيرة تعرّف الزوار بالمهرجان وأنشطته.",
  descriptionEn: "A short welcome workshop introducing the festival and its activities.",
  tags: ["ثقافة", "أطفال", "هدوء"],
};
function activityContent(activity: { description?: string; description_en?: string; tags?: string[]; highlights?: string[] }) {
  return {
    descriptionAr: activity.description ?? null,
    descriptionEn: activity.description_en ?? null,
    tags: activity.tags ?? [],
    highlightsAr: activity.highlights ?? [],
  };
}

/** Boulevard World plan → GPS: plan (0, 0) is the traced park centre, 1 unit = 0.62 m, x due east. */
const BOULEVARD_GEO_CALIBRATION = { geoAnchorLat: 24.7766539, geoAnchorLng: 46.6003677, metersPerUnit: 0.62, rotationDeg: 0 };

loadProjectEnv();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to seed the database. Set it in the environment or a project env file.");
}

const db = new PrismaClient({
  adapter: new PrismaPg(...prismaPgArgs(databaseUrl)),
});
const referenceDate = new Date("2026-11-20T00:00:00+03:00");

function timeAtMinute(minute: number) {
  const date = new Date(referenceDate);
  date.setUTCMinutes(date.getUTCMinutes() + minute);
  return date;
}

function centsFromSar(value: number | undefined) {
  return typeof value === "number" ? Math.round(value * 100) : null;
}

function idFor(prefix: string, value: string) {
  return `${prefix}_${value}`.replace(/[^a-zA-Z0-9_]/g, "_");
}

function seedPasswordHash(password: string | undefined) {
  return password ? hashPassword(password) : undefined;
}

// The sample festival opens 16:00–23:00 so its activities (the workshop included) can be planned.
const SAMPLE_FESTIVAL_CONFIG = { opening: { from: 960, to: 1380 } };

async function seedIsolationEvent(organization: any, owner: any) {
  const venue = await db.venue.upsert({
    where: { organizationId_slug: { organizationId: organization.id, slug: "sample-festival-venue" } },
    update: { name: "WANEES Sample Venue", timezone: "Asia/Riyadh" },
    create: {
      organizationId: organization.id,
      name: "WANEES Sample Venue",
      slug: "sample-festival-venue",
      timezone: "Asia/Riyadh",
    },
  });

  const event = await db.event.upsert({
    where: { organizationId_slug: { organizationId: organization.id, slug: "sample-festival" } },
    update: {
      name: "WANEES Sample Festival",
      venueId: venue.id,
      status: "PUBLISHED",
      defaultLocale: "ar-SA",
      startsAt: new Date("2026-12-01T16:00:00+03:00"),
      endsAt: new Date("2026-12-05T23:00:00+03:00"),
    },
    create: {
      organizationId: organization.id,
      venueId: venue.id,
      name: "WANEES Sample Festival",
      slug: "sample-festival",
      description: "Small second event used to verify multi-event isolation.",
      status: "PUBLISHED",
      defaultLocale: "ar-SA",
      startsAt: new Date("2026-12-01T16:00:00+03:00"),
      endsAt: new Date("2026-12-05T23:00:00+03:00"),
    },
  });

  const catalog = await db.catalogVersion.upsert({
    where: { eventId_versionNumber: { eventId: event.id, versionNumber: 1 } },
    update: { status: "PUBLISHED", config: SAMPLE_FESTIVAL_CONFIG, publishedById: owner.id, publishedAt: new Date() },
    create: {
      eventId: event.id,
      versionNumber: 1,
      status: "PUBLISHED",
      sourceSummary: "Seeded isolation fixture",
      config: SAMPLE_FESTIVAL_CONFIG,
      // Fixture catalog: inserted as already published, so no crosswalk applies.
      // The database only accepts NOT_REQUIRED on an insert that is already PUBLISHED.
      crosswalkStatus: "NOT_REQUIRED",
      createdById: owner.id,
      publishedById: owner.id,
      publishedAt: new Date(),
    },
  });

  await db.event.update({ where: { id: event.id }, data: { publishedCatalogVersionId: catalog.id } });

  const zone = await db.zone.upsert({
    where: { catalogVersionId_stableKey: { catalogVersionId: catalog.id, stableKey: "sample-zone" } },
    update: { nameAr: "الساحة الرئيسية", mapX: 0, mapY: 0, tags: ["sample"], popularityWeight: 0.5, reviewStatus: "VERIFIED", sourceRefs: ["source_sample_festival"] },
    create: {
      catalogVersionId: catalog.id,
      stableKey: "sample-zone",
      nameAr: "الساحة الرئيسية",
      nameEn: "Main Square",
      mapX: 0,
      mapY: 0,
      tags: ["sample"],
      popularityWeight: 0.5,
      reviewStatus: "VERIFIED",
      sourceRefs: ["source_sample_festival"],
    },
  });

  const activity = await db.activity.upsert({
    where: { catalogVersionId_stableKey: { catalogVersionId: catalog.id, stableKey: "sample-workshop" } },
    update: { zoneId: zone.id, nameAr: "ورشة تعريفية", ...SAMPLE_WORKSHOP_CONTENT, durationMin: 30, priceMinCents: 0, priceMaxCents: 0, reviewStatus: "VERIFIED", sourceRefs: ["source_sample_festival"] },
    create: {
      catalogVersionId: catalog.id,
      zoneId: zone.id,
      stableKey: "sample-workshop",
      nameAr: "ورشة تعريفية",
      nameEn: "Welcome Workshop",
      ...SAMPLE_WORKSHOP_CONTENT,
      type: "experience",
      durationMin: 30,
      priceMinCents: 0,
      priceMaxCents: 0,
      familyFriendly: true,
      interests: ["ثقافة"],
      moods: ["هادئ"],
      popularityWeight: 0.5,
      reviewStatus: "VERIFIED",
      sourceRefs: ["source_sample_festival"],
    },
  });

  await db.$transaction(async (tx) => {
    await tx.schedule.deleteMany({
      where: {
        activityId: activity.id,
        id: { not: "sample_schedule_workshop" },
      },
    });
    await tx.schedule.upsert({
      where: { id: "sample_schedule_workshop" },
      update: { activityId: activity.id, startsAt: timeAtMinute(960), endsAt: timeAtMinute(990), eventDate: referenceDate, kind: "continuous" },
      create: {
        id: "sample_schedule_workshop",
        activityId: activity.id,
        startsAt: timeAtMinute(960),
        endsAt: timeAtMinute(990),
        eventDate: referenceDate,
        kind: "continuous",
      },
    });
  });

  await db.contentSource.upsert({
    where: { id: "source_sample_festival" },
    update: { title: "WANEES sample event fixture", observedAt: new Date(), reviewStatus: "VERIFIED" },
    create: {
      id: "source_sample_festival",
      catalogVersionId: catalog.id,
      sourceType: "fixture",
      title: "WANEES sample event fixture",
      locator: "prisma/seed.ts",
      observedAt: new Date(),
      trustLevel: "operator_verified",
      reviewStatus: "VERIFIED",
    },
  });

  return event;
}

async function seedBoulevardCatalog(
  source: any,
  organization: { id: string },
  owner: { id: string },
  eventSlug: string,
) {
  const isPitch = eventSlug === PITCH_EVENT_SLUG;
  const eventName = isPitch ? "بوليفارد وورلد — عرض تجريبي" : "بوليفارد وورلد — موسم الرياض";
  const startsAt = new Date("2026-11-01T17:00:00+03:00");
  const endsAt = isPitch ? new Date("2030-01-01T00:00:00+03:00") : new Date("2027-05-23T00:00:00+03:00");
  // Navigation settings are venue data (docs/MAP_AND_CROWD_SENSING.md). The plan was traced from
  // satellite imagery, so guidance is live but APPROXIMATE until a field walk (audit item 3.8).
  // The isolated rehearsal runs on a scripted clock and never uses the visitor's real GPS.
  const navigation = {
    ...BOULEVARD_GEO_CALIBRATION,
    liveGuidance: !isPitch,
    navigationAccuracy: "APPROXIMATE" as const,
    gpsSimulation: !isPitch,
  };
  const venue = await db.venue.upsert({
    where: { organizationId_slug: { organizationId: organization.id, slug: "boulevard-world" } },
    update: {
      name: "Boulevard World",
      timezone: "Asia/Riyadh",
      address: "Riyadh, Saudi Arabia",
      ...navigation,
    },
    create: {
      organizationId: organization.id,
      name: "Boulevard World",
      slug: "boulevard-world",
      timezone: "Asia/Riyadh",
      address: "Riyadh, Saudi Arabia",
      ...navigation,
    },
  });

  const event = await db.event.upsert({
    where: { organizationId_slug: { organizationId: organization.id, slug: eventSlug } },
    update: {
      name: eventName,
      description: isPitch ? "Isolated rehearsal with sample operating data." : "WANEES reference event configuration for the first interactive guide demo.",
      venueId: venue.id,
      status: "LIVE",
      defaultLocale: "ar-SA",
      startsAt: startsAt,
      endsAt: endsAt,
    },
    create: {
      organizationId: organization.id,
      venueId: venue.id,
      name: eventName,
      slug: eventSlug,
      description: isPitch ? "Isolated rehearsal with sample operating data." : "WANEES reference event configuration for the first interactive guide demo.",
      status: "LIVE",
      defaultLocale: "ar-SA",
      startsAt: startsAt,
      endsAt: endsAt,
    },
  });

  const catalog = await db.catalogVersion.upsert({
    where: { eventId_versionNumber: { eventId: event.id, versionNumber: 1 } },
    update: {
      status: "PUBLISHED",
      sourceSummary: source.meta?.source ?? "Boulevard World demo fixture",
      validationReport: { source: "json-fixture", zones: source.zones.length, activities: source.activities.length },
      config: source.site,
      publishedById: owner.id,
      publishedAt: new Date("2026-11-20T15:00:00+03:00"),
    },
    create: {
      eventId: event.id,
      versionNumber: 1,
      status: "PUBLISHED",
      sourceSummary: source.meta?.source ?? "Boulevard World demo fixture",
      validationReport: { source: "json-fixture", zones: source.zones.length, activities: source.activities.length },
      config: source.site,
      // Fixture catalog, inserted as already published (see the sample fixture above).
      crosswalkStatus: "NOT_REQUIRED",
      createdById: owner.id,
      publishedById: owner.id,
      publishedAt: new Date("2026-11-20T15:00:00+03:00"),
    },
  });

  await db.event.update({
    where: { id: event.id },
    data: { publishedCatalogVersionId: catalog.id },
  });

  const zoneIds = new Map<string, string>();
  for (const zone of source.zones) {
    const stored = await db.zone.upsert({
      where: { catalogVersionId_stableKey: { catalogVersionId: catalog.id, stableKey: zone.id } },
      update: {
        nameAr: zone.name,
        ...(isPitch ? { capacity: 100 } : {}),
        mapX: zone.x,
        mapY: zone.y,
        tags: ["boulevard-world", "demo"],
        popularityWeight: zone.popularity ?? 0.5,
        reviewStatus: "VERIFIED",
        sourceRefs: [idFor("source", eventSlug)],
      },
      create: {
        catalogVersionId: catalog.id,
        stableKey: zone.id,
        nameAr: zone.name,
        ...(isPitch ? { capacity: 100 } : {}),
        mapX: zone.x,
        mapY: zone.y,
        tags: ["boulevard-world", "demo"],
        popularityWeight: zone.popularity ?? 0.5,
        reviewStatus: "VERIFIED",
        sourceRefs: [idFor("source", eventSlug)],
      },
    });
    zoneIds.set(zone.id, stored.id);
  }

  // Earlier seeds linked some prices to a ticket-seller page; that source is no longer used.
  await db.contentSource.deleteMany({ where: { catalogVersionId: catalog.id, sourceType: "official_ticketing" } });
  const activitySourceRefs = (activity: any) => [
    idFor("source", eventSlug),
  ];

  // Re-seeding an older database: anything the current season catalog no longer lists stops being offered.
  await db.activity.updateMany({
    where: { catalogVersionId: catalog.id, stableKey: { notIn: source.activities.map((activity: any) => activity.id) } },
    data: { status: "EXPIRED" },
  });

  for (const activity of source.activities) {
    const zoneId = zoneIds.get(activity.zone);
    if (!zoneId) throw new Error(`Unknown zone ${activity.zone} for activity ${activity.id}`);

    const stored = await db.activity.upsert({
      where: { catalogVersionId_stableKey: { catalogVersionId: catalog.id, stableKey: activity.id } },
      update: {
        zoneId,
        nameAr: activity.name,
        nameEn: activity.name_en,
        type: activity.type,
        durationMin: activity.duration_min,
        priceMinCents: centsFromSar(activity.price),
        priceMaxCents: centsFromSar(activity.price),
        ageMin: activity.min_age,
        familyFriendly: Boolean(activity.family),
        interests: activity.interests ?? [],
        ...activityContent(activity),
        moods: activity.moods ?? [],
        popularityWeight: activity.popularity ?? 0,
        status: "ACTIVE",
        reviewStatus: "VERIFIED",
        sourceRefs: activitySourceRefs(activity),
      },
      create: {
        catalogVersionId: catalog.id,
        zoneId,
        stableKey: activity.id,
        nameAr: activity.name,
        nameEn: activity.name_en,
        type: activity.type,
        durationMin: activity.duration_min,
        priceMinCents: centsFromSar(activity.price),
        priceMaxCents: centsFromSar(activity.price),
        ageMin: activity.min_age,
        familyFriendly: Boolean(activity.family),
        interests: activity.interests ?? [],
        ...activityContent(activity),
        moods: activity.moods ?? [],
        popularityWeight: activity.popularity ?? 0,
        reviewStatus: "VERIFIED",
        sourceRefs: activitySourceRefs(activity),
      },
    });

    const schedules = activity.schedule?.type === "slots"
      ? (activity.schedule.slots ?? []).map((start: number, index: number) => ({
          id: idFor("schedule", `${activity.id}_${index}`),
          start: start,
          end: start + activity.duration_min,
          kind: "slots",
        }))
      : [{
          id: idFor("schedule", activity.id),
          start: activity.schedule?.from ?? 1020,
          end: activity.schedule?.to ?? 1400,
          kind: "continuous",
        }];

    // Keep fixture re-seeds authoritative: remove schedule rows that no longer
    // exist in the source instead of leaving stale slots queryable. The delete
    // and recreate run in one transaction so a failed seed cannot leave an
    // activity without schedules.
    await db.$transaction(async (tx) => {
      await tx.schedule.deleteMany({
        where: {
          activityId: stored.id,
          id: { notIn: schedules.map((schedule) => schedule.id) },
        },
      });

      for (const schedule of schedules) {
        await tx.schedule.upsert({
          where: { id: schedule.id },
          update: {
            startsAt: timeAtMinute(schedule.start),
            endsAt: timeAtMinute(schedule.end),
            eventDate: referenceDate,
            kind: schedule.kind,
            status: "active",
          },
          create: {
            id: schedule.id,
            activityId: stored.id,
            eventDate: referenceDate,
            startsAt: timeAtMinute(schedule.start),
            endsAt: timeAtMinute(schedule.end),
            status: "active",
            kind: schedule.kind,
          },
        });
      }
    });
  }

  // Gates and services sit on land next to the zones they serve (positions match the real site layout).
  const zoneNodeFor = (point: { x: number; y: number }) => {
    const key = nearestNodeKey(source.zones.map((zone: any) => ({ key: zone.id, type: "ZONE", x: zone.x, y: zone.y })), point);
    return key ? zoneIds.get(key) ?? null : null;
  };
  const routeNodes = [
    // Gates from the official park map: KSA 1 (main, from Boulevard City) and KSA 2 (north).
    ...BOULEVARD_GATES.map((gate) => ({ ...gate, type: "ENTRANCE", zoneId: zoneNodeFor(gate) })),
    ...source.zones.map((zone: any) => ({
      key: `zone-${zone.id}`,
      type: "ZONE",
      label: zone.name,
      aliases: [],
      description: `منطقة ${zone.name}`,
      x: zone.x,
      y: zone.y,
      zoneId: zoneIds.get(zone.id) ?? null,
    })),
    { key: "service-restrooms-main", type: "SERVICE", label: "دورات المياه الرئيسية", aliases: ["دورة مياه", "حمام", "الحمامات"], description: "دورات مياه قريبة من المسار الرئيسي.", x: -60, y: -250, zoneId: zoneNodeFor({ x: -60, y: -250 }) },
    { key: "service-medical-main", type: "SERVICE", label: "نقطة الإسعاف", aliases: ["إسعاف", "عيادة", "ممرض"], description: "نقطة مساعدة طبية داخل الموقع.", x: 340, y: -170, zoneId: zoneNodeFor({ x: 340, y: -170 }) },
    ...zoneServiceNodes(source.zones, zoneIds),
    { key: "service-information-main", type: "SERVICE", label: "نقطة المعلومات", aliases: ["معلومات", "استعلامات", "مساعدة"], description: "مساعدة الزوار والاستفسار عن الفعالية.", x: -200, y: 530, zoneId: zoneNodeFor({ x: -200, y: 530 }) },
  ];
  const nodeIds = new Map<string, string>();
  for (const node of routeNodes) {
    const stored = await db.routeNode.upsert({
      where: { catalogVersionId_stableKey: { catalogVersionId: catalog.id, stableKey: node.key } },
      update: { type: node.type, label: node.label, aliases: node.aliases, description: node.description, status: "open", x: node.x, y: node.y, zoneId: node.zoneId, accessible: (node as { accessible?: boolean }).accessible ?? true },
      create: {
        catalogVersionId: catalog.id,
        stableKey: node.key,
        type: node.type,
        label: node.label,
        aliases: node.aliases,
        description: node.description,
        status: "open",
        x: node.x,
        y: node.y,
        zoneId: node.zoneId,
        accessible: (node as { accessible?: boolean }).accessible ?? true,
      },
    });
    nodeIds.set(node.key, stored.id);
  }

  // Walkways follow the lagoon promenade; edges from the old sequential chain are removed first.
  const walkway = buildWalkwayEdges(routeNodes, {
    center: BOULEVARD_CENTER,
    obstacle: BOULEVARD_LAGOON,
    metresPerUnit: 0.62,
    walkingSpeedMPerMin: source.site?.walking_speed_m_per_min ?? 65,
  });
  const walkwayIds = walkway
    .map((edge) => [nodeIds.get(edge.from), nodeIds.get(edge.to)] as const)
    .filter((pair): pair is readonly [string, string] => Boolean(pair[0] && pair[1]));
  await db.routeEdge.deleteMany({
    where: {
      catalogVersionId: catalog.id,
      NOT: { OR: walkwayIds.map(([fromNodeId, toNodeId]) => ({ fromNodeId, toNodeId })) },
    },
  });
  for (const edge of walkway) {
    const edgeFrom = nodeIds.get(edge.from);
    const edgeTo = nodeIds.get(edge.to);
    if (!edgeFrom || !edgeTo) continue;
    const distance = edge.distanceM;
    const walkMin = edge.walkMin;
    {
      await db.routeEdge.upsert({
        where: { catalogVersionId_fromNodeId_toNodeId: { catalogVersionId: catalog.id, fromNodeId: edgeFrom, toNodeId: edgeTo } },
        update: { distanceM: distance, walkMin, status: "open" },
        create: {
          catalogVersionId: catalog.id,
          fromNodeId: edgeFrom,
          toNodeId: edgeTo,
          distanceM: distance,
          walkMin,
          status: "open",
        },
      });
    }
  }

  await db.contentSource.upsert({
    where: { id: idFor("source", eventSlug) },
    update: { title: source.meta?.source ?? "Boulevard World JSON fixture", locator: "app/data/boulevard_world_2026.json", observedAt: new Date(), reviewStatus: "VERIFIED" },
    create: {
      id: idFor("source", eventSlug),
      catalogVersionId: catalog.id,
      sourceType: "fixture",
      title: source.meta?.source ?? "Boulevard World JSON fixture",
      locator: "app/data/boulevard_world_2026.json",
      observedAt: new Date(),
      trustLevel: "operator_verified",
      reviewStatus: "VERIFIED",
    },
  });

  for (const zone of isPitch ? [] : source.zones) {
    const zoneId = zoneIds.get(zone.id);
    if (!zoneId) continue;
    await db.crowdSnapshot.upsert({
      where: { id: idFor("crowd", zone.id) },
      update: {
        level: Math.min(0.98, Math.max(0.08, zone.popularity * 0.75)),
        source: "SIMULATED",
        confidence: 0.55,
        observedAt: new Date("2026-11-20T20:00:00+03:00"),
        expiresAt: new Date("2026-11-20T20:15:00+03:00"),
      },
      create: {
        id: idFor("crowd", zone.id),
        eventId: event.id,
        zoneId,
        level: Math.min(0.98, Math.max(0.08, zone.popularity * 0.75)),
        source: "SIMULATED",
        confidence: 0.55,
        observedAt: new Date("2026-11-20T20:00:00+03:00"),
        expiresAt: new Date("2026-11-20T20:15:00+03:00"),
      },
    });
  }

  await db.auditLog.create({
    data: {
      organizationId: organization.id,
      actorUserId: owner.id,
      action: "seed.demo_catalog",
      entityType: "Event",
      entityId: event.id,
      afterSummary: { eventSlug, catalogVersion: 1, zones: source.zones.length, activities: source.activities.length },
    },
  });

  return event;
}

// Toilets and prayer rooms marked on the official park map, one per zone they are drawn in. The map is
// an illustration, so each sits next to its zone's position and is described as "inside the zone".
const SERVICE_KINDS = {
  toilets: { label: "دورات المياه", aliases: ["دورة مياه", "دورات مياه", "حمام", "حمامات", "الحمامات", "توليت", "toilet", "restroom", "wc"], what: "دورات مياه" },
  prayer: { label: "المصلى", aliases: ["مصلى", "مصلي", "صلاة", "اصلي", "أصلي", "مسجد", "prayer room"], what: "مصلى" },
} as const;
function zoneServiceNodes(zones: any[], zoneIds: Map<string, string>) {
  const file = JSON.parse(readFileSync(join(process.cwd(), "data", "sources", "boulevard_world_2026_services.json"), "utf8"));
  const byId = new Map(zones.map((zone: any) => [zone.id, zone]));
  const offsets: Record<string, { x: number; y: number }> = { toilets: { x: 14, y: 10 }, prayer: { x: -14, y: 10 } };
  return (file.services as { kind: keyof typeof SERVICE_KINDS; zone: string }[])
    .filter((service) => byId.has(service.zone) && SERVICE_KINDS[service.kind])
    .map((service) => {
      const zone = byId.get(service.zone);
      const kind = SERVICE_KINDS[service.kind];
      return {
        key: `service-${service.kind}-${service.zone}`,
        type: "SERVICE",
        label: `${kind.label} — ${zone.name}`,
        aliases: [...kind.aliases],
        description: `${kind.what} داخل ${zone.name} حسب خريطة بوليفارد وورلد الرسمية.`,
        // The map draws a disabled-toilet icon beside its toilets; it says nothing about prayer rooms.
        accessible: service.kind === "toilets",
        x: zone.x + offsets[service.kind].x,
        y: zone.y + offsets[service.kind].y,
        zoneId: zoneIds.get(service.zone) ?? null,
      };
    });
}

async function main() {
  // The 2026-27 season catalog, built by scripts/build-boulevard-2026-catalog.mjs from the sources in data/sources/.
  const sourcePath = join(process.cwd(), "app", "data", "boulevard_world_2026.json");
  const source = JSON.parse(readFileSync(sourcePath, "utf8"));
  const eventSlug = "boulevard-world-demo";

  if (process.argv.includes("--pitch")) {
    const password = process.env.WANEES_PITCH_OPERATOR_PASSWORD;
    if (!password) throw new Error("WANEES_PITCH_OPERATOR_PASSWORD is required to provision the isolated rehearsal.");
    const organization = await db.organization.upsert({
      where: { slug: PITCH_ORGANIZATION_SLUG },
      update: { status: "ACTIVE" },
      create: { name: "WANEES Pitch Rehearsal", slug: PITCH_ORGANIZATION_SLUG },
    });
    const email = "operator@pitch.wanees.demo";
    const passwordHash = hashPassword(password);
    const operator = await db.user.upsert({
      where: { email },
      update: { status: "ACTIVE", passwordHash },
      create: { email, displayName: "مشغّل العرض التجريبي", status: "ACTIVE", passwordHash },
    });
    await db.membership.upsert({
      where: { organizationId_userId: { organizationId: organization.id, userId: operator.id } },
      update: { role: "OPERATOR" },
      create: { organizationId: organization.id, userId: operator.id, role: "OPERATOR" },
    });
    await seedBoulevardCatalog(source, organization, operator, PITCH_EVENT_SLUG);
    console.log("Seeded the isolated Boulevard World rehearsal.");
    return;
  }

  const organization = await db.organization.upsert({
    where: { slug: "wanees-demo" },
    update: { name: "WANEES Demo Organization", status: "ACTIVE" },
    create: { name: "WANEES Demo Organization", slug: "wanees-demo" },
  });

  const ownerPasswordHash = seedPasswordHash(process.env.WANEES_OWNER_PASSWORD);
  const owner = await db.user.upsert({
    where: { email: "owner@wanees.demo" },
    update: { displayName: "WANEES Demo Owner", status: "ACTIVE", passwordHash: ownerPasswordHash },
    create: {
      email: "owner@wanees.demo",
      displayName: "WANEES Demo Owner",
      status: "ACTIVE",
      passwordHash: ownerPasswordHash,
      externalAuthSubject: "seed:owner@wanees.demo",
    },
  });

  await db.membership.upsert({
    where: { organizationId_userId: { organizationId: organization.id, userId: owner.id } },
    update: { role: "OWNER" },
    create: { organizationId: organization.id, userId: owner.id, role: "OWNER" },
  });

  // Real least-privilege demo account using the canonical database login path.
  const demoPasswordHash = seedPasswordHash(process.env.WANEES_DEMO_PASSWORD);
  const demo = await db.user.upsert({
    where: { email: "demo@wanees.demo" },
    update: { displayName: "WANEES Demo Viewer", status: "ACTIVE", passwordHash: demoPasswordHash },
    create: {
      email: "demo@wanees.demo",
      displayName: "WANEES Demo Viewer",
      status: "ACTIVE",
      passwordHash: demoPasswordHash,
      externalAuthSubject: "seed:demo@wanees.demo",
    },
  });

  await db.membership.upsert({
    where: { organizationId_userId: { organizationId: organization.id, userId: demo.id } },
    update: { role: "VIEWER" },
    create: { organizationId: organization.id, userId: demo.id, role: "VIEWER" },
  });

  const event = await seedBoulevardCatalog(source, organization, owner, eventSlug);
  const isolationEvent = await seedIsolationEvent(organization, owner);
  console.log(`Seeded ${event.name}: ${source.zones.length} zones, ${source.activities.length} activities.`);
  console.log(`Seeded ${isolationEvent.name}: isolated sample catalog.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
