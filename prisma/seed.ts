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

// Audit 6.4: the second event is a whole event of its own (app/data/sample_festival.json): its own
// venue calibration, gates, services, walkways, content, tags and schedules, seeded through the same
// helpers as Boulevard World so every test can run on it. The content is test data, not a real festival.
async function seedSampleFestival(organization: any, owner: any) {
  const source = JSON.parse(readFileSync(join(process.cwd(), "app", "data", "sample_festival.json"), "utf8"));
  const site = source.venue;
  const navigation = { ...site.calibration, liveGuidance: true, navigationAccuracy: "APPROXIMATE" as const, gpsSimulation: true };
  const venue = await db.venue.upsert({
    where: { organizationId_slug: { organizationId: organization.id, slug: site.slug } },
    update: { name: site.name, timezone: "Asia/Riyadh", address: site.address, ...navigation },
    create: { organizationId: organization.id, name: site.name, slug: site.slug, timezone: "Asia/Riyadh", address: site.address, ...navigation },
  });

  const eventFields = {
    name: source.site.name,
    description: "فعالية ثانية تجريبية تثبت أن ونيس يعمل على أي فعالية (بيانات اختبار).",
    venueId: venue.id,
    status: "LIVE" as const,
    defaultLocale: "ar-SA",
    startsAt: new Date("2026-11-01T16:00:00+03:00"),
    endsAt: new Date("2027-05-23T00:00:00+03:00"),
  };
  const event = await db.event.upsert({
    where: { organizationId_slug: { organizationId: organization.id, slug: "sample-festival" } },
    update: eventFields,
    create: { organizationId: organization.id, slug: "sample-festival", ...eventFields },
  });

  const catalogFields = {
    status: "PUBLISHED" as const,
    sourceSummary: source.meta.source,
    validationReport: { source: "json-fixture", zones: source.zones.length, activities: source.activities.length },
    config: source.site,
    publishedById: owner.id,
    publishedAt: new Date("2026-11-20T15:00:00+03:00"),
  };
  const catalog = await db.catalogVersion.upsert({
    where: { eventId_versionNumber: { eventId: event.id, versionNumber: 1 } },
    update: catalogFields,
    // Fixture catalog: inserted as already published, so no crosswalk applies.
    // The database only accepts NOT_REQUIRED on an insert that is already PUBLISHED.
    create: { eventId: event.id, versionNumber: 1, crosswalkStatus: "NOT_REQUIRED", createdById: owner.id, ...catalogFields },
  });
  await db.event.update({ where: { id: event.id }, data: { publishedCatalogVersionId: catalog.id } });

  const sourceRef = "source_sample_festival";
  await db.contentSource.upsert({
    where: { id: sourceRef },
    update: { title: source.meta.source, locator: "app/data/sample_festival.json", observedAt: new Date(), reviewStatus: "VERIFIED" },
    create: { id: sourceRef, catalogVersionId: catalog.id, sourceType: "fixture", title: source.meta.source, locator: "app/data/sample_festival.json", observedAt: new Date(), trustLevel: "operator_verified", reviewStatus: "VERIFIED" },
  });

  const zoneIds = new Map<string, string>();
  for (const zone of source.zones) {
    const fields = { nameAr: zone.name, nameEn: zone.name_en, mapX: zone.x, mapY: zone.y, tags: ["sample-festival"], popularityWeight: zone.popularity, reviewStatus: "VERIFIED" as const, sourceRefs: [sourceRef] };
    const stored = await db.zone.upsert({
      where: { catalogVersionId_stableKey: { catalogVersionId: catalog.id, stableKey: zone.id } },
      update: fields,
      create: { catalogVersionId: catalog.id, stableKey: zone.id, ...fields },
    });
    zoneIds.set(zone.id, stored.id);
  }
  // Earlier seeds of this fixture used a different schedule id for the workshop.
  await db.schedule.deleteMany({ where: { id: "sample_schedule_workshop" } });
  await seedActivities(catalog.id, zoneIds, source.activities, [sourceRef]);

  const zoneNodeFor = (point: { x: number; y: number }) => {
    const key = nearestNodeKey(source.zones.map((zone: any) => ({ key: zone.id, type: "ZONE", x: zone.x, y: zone.y })), point);
    return key ? zoneIds.get(key) ?? null : null;
  };
  const routeNodes = [
    ...site.gates.map((gate: any) => ({ ...gate, type: "ENTRANCE", zoneId: zoneNodeFor(gate) })),
    ...source.zones.map((zone: any) => ({ key: `zone-${zone.id}`, type: "ZONE", label: zone.name, aliases: [], description: `منطقة ${zone.name}`, x: zone.x, y: zone.y, zoneId: zoneIds.get(zone.id) ?? null })),
    ...zoneServiceNodes(site.services, source.zones, zoneIds, source.site.name),
    ...site.points.map((point: any) => ({ ...point, type: "SERVICE", zoneId: zoneNodeFor(point) })),
  ];
  await seedRouteGraph(catalog.id, routeNodes, { center: site.center, metresPerUnit: site.calibration.metersPerUnit, walkingSpeedMPerMin: source.site.walking_speed_m_per_min });
  await seedSimulatedCrowd(event.id, source.zones, zoneIds);
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
  await seedActivities(catalog.id, zoneIds, source.activities, [idFor("source", eventSlug)]);

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
    ...zoneServiceNodes(boulevardServices(), source.zones, zoneIds, "بوليفارد وورلد الرسمية"),
    { key: "service-information-main", type: "SERVICE", label: "نقطة المعلومات", aliases: ["معلومات", "استعلامات", "مساعدة"], description: "مساعدة الزوار والاستفسار عن الفعالية.", x: -200, y: 530, zoneId: zoneNodeFor({ x: -200, y: 530 }) },
  ];
  // Walkways follow the lagoon promenade.
  await seedRouteGraph(catalog.id, routeNodes, {
    center: BOULEVARD_CENTER,
    obstacle: BOULEVARD_LAGOON,
    metresPerUnit: 0.62,
    walkingSpeedMPerMin: source.site?.walking_speed_m_per_min ?? 65,
  });

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

  if (!isPitch) await seedSimulatedCrowd(event.id, source.zones, zoneIds);

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
function boulevardServices() {
  return JSON.parse(readFileSync(join(process.cwd(), "data", "sources", "boulevard_world_2026_services.json"), "utf8")).services;
}
function zoneServiceNodes(services: { kind: string; zone: string }[], zones: any[], zoneIds: Map<string, string>, mapName: string) {
  const byId = new Map(zones.map((zone: any) => [zone.id, zone]));
  const offsets: Record<string, { x: number; y: number }> = { toilets: { x: 14, y: 10 }, prayer: { x: -14, y: 10 } };
  return (services as { kind: keyof typeof SERVICE_KINDS; zone: string }[])
    .filter((service) => byId.has(service.zone) && SERVICE_KINDS[service.kind])
    .map((service) => {
      const zone = byId.get(service.zone);
      const kind = SERVICE_KINDS[service.kind];
      return {
        key: `service-${service.kind}-${service.zone}`,
        type: "SERVICE",
        label: `${kind.label} — ${zone.name}`,
        aliases: [...kind.aliases],
        description: `${kind.what} داخل ${zone.name} حسب خريطة ${mapName}.`,
        // The map draws a disabled-toilet icon beside its toilets; it says nothing about prayer rooms.
        accessible: service.kind === "toilets",
        x: zone.x + offsets[service.kind].x,
        y: zone.y + offsets[service.kind].y,
        zoneId: zoneIds.get(service.zone) ?? null,
      };
    });
}

/** Activities and their schedules for one catalog version; re-seeding removes stale rows. */
async function seedActivities(catalogVersionId: string, zoneIds: Map<string, string>, activities: any[], sourceRefs: string[]) {
  // Re-seeding an older database: anything the current catalog no longer lists stops being offered.
  await db.activity.updateMany({
    where: { catalogVersionId, stableKey: { notIn: activities.map((activity: any) => activity.id) } },
    data: { status: "EXPIRED" },
  });

  for (const activity of activities) {
    const zoneId = zoneIds.get(activity.zone);
    if (!zoneId) throw new Error(`Unknown zone ${activity.zone} for activity ${activity.id}`);
    const fields = {
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
      reviewStatus: "VERIFIED" as const,
      sourceRefs,
    };
    const stored = await db.activity.upsert({
      where: { catalogVersionId_stableKey: { catalogVersionId, stableKey: activity.id } },
      update: { ...fields, status: "ACTIVE" },
      create: { catalogVersionId, stableKey: activity.id, ...fields },
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
          id: { notIn: schedules.map((schedule: any) => schedule.id) },
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
}

/** Route nodes (gates, zones, services) and the walkway edges between them for one catalog version. */
async function seedRouteGraph(catalogVersionId: string, routeNodes: any[], walkwayOptions: Parameters<typeof buildWalkwayEdges>[1]) {
  const nodeIds = new Map<string, string>();
  for (const node of routeNodes) {
    const fields = { type: node.type, label: node.label, aliases: node.aliases, description: node.description, status: "open", x: node.x, y: node.y, zoneId: node.zoneId, accessible: node.accessible ?? true };
    const stored = await db.routeNode.upsert({
      where: { catalogVersionId_stableKey: { catalogVersionId, stableKey: node.key } },
      update: fields,
      create: { catalogVersionId, stableKey: node.key, ...fields },
    });
    nodeIds.set(node.key, stored.id);
  }

  // Edges from an older layout are removed first.
  const walkway = buildWalkwayEdges(routeNodes, walkwayOptions);
  const walkwayIds = walkway
    .map((edge) => [nodeIds.get(edge.from), nodeIds.get(edge.to)] as const)
    .filter((pair): pair is readonly [string, string] => Boolean(pair[0] && pair[1]));
  await db.routeEdge.deleteMany({
    where: {
      catalogVersionId,
      NOT: { OR: walkwayIds.map(([fromNodeId, toNodeId]) => ({ fromNodeId, toNodeId })) },
    },
  });
  for (const edge of walkway) {
    const fromNodeId = nodeIds.get(edge.from);
    const toNodeId = nodeIds.get(edge.to);
    if (!fromNodeId || !toNodeId) continue;
    await db.routeEdge.upsert({
      where: { catalogVersionId_fromNodeId_toNodeId: { catalogVersionId, fromNodeId, toNodeId } },
      update: { distanceM: edge.distanceM, walkMin: edge.walkMin, status: "open" },
      create: { catalogVersionId, fromNodeId, toNodeId, distanceM: edge.distanceM, walkMin: edge.walkMin, status: "open" },
    });
  }
}

/** Simulated crowd levels (labelled SIMULATED) until a venue provides real counts. */
async function seedSimulatedCrowd(eventId: string, zones: any[], zoneIds: Map<string, string>) {
  for (const zone of zones) {
    const zoneId = zoneIds.get(zone.id);
    if (!zoneId) continue;
    const fields = {
      level: Math.min(0.98, Math.max(0.08, (zone.popularity ?? 0.5) * 0.75)),
      source: "SIMULATED" as const,
      confidence: 0.55,
      observedAt: new Date("2026-11-20T20:00:00+03:00"),
      expiresAt: new Date("2026-11-20T20:15:00+03:00"),
    };
    await db.crowdSnapshot.upsert({
      where: { id: idFor("crowd", zone.id) },
      update: fields,
      create: { id: idFor("crowd", zone.id), eventId, zoneId, ...fields },
    });
  }
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
  const sampleEvent = await seedSampleFestival(organization, owner);
  console.log(`Seeded ${event.name}: ${source.zones.length} zones, ${source.activities.length} activities.`);
  console.log(`Seeded ${sampleEvent.name}: the second event (app/data/sample_festival.json).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
