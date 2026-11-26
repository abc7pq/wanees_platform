import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeEventRequest } from "@/lib/catalog-auth";
import { withAdminApiContract } from "@/lib/api-response";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export const GET = withAdminApiContract(async function GET(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  const access = await authorizeEventRequest(request, eventSlug, ["OWNER", "ADMIN", "OPERATOR", "EDITOR", "ANALYST", "VIEWER"]);
  if (!access.authorized) return errorResponse(access.userId ? "FORBIDDEN" : "UNAUTHORIZED", access.userId ? "لا تملك صلاحية هذه الفعالية." : "غير مصرح.", access.userId ? 403 : 401);
  if (!access.event) return errorResponse("EVENT_NOT_FOUND", "الفعالية غير موجودة.", 404);

  const versions = await prisma.catalogVersion.findMany({
    where: { eventId: access.event.id },
    orderBy: { versionNumber: "desc" },
    include: { _count: { select: { zones: true, activities: true, contentSources: true, routeNodes: true, routeEdges: true } } },
  });
  const requestedVersion = new URL(request.url).searchParams.get("versionId");
  const selectedId = requestedVersion ?? access.event.publishedCatalogVersionId ?? versions[0]?.id;
  const selected = selectedId
    ? await prisma.catalogVersion.findFirst({
        where: { id: selectedId, eventId: access.event.id },
        include: {
          zones: { orderBy: { stableKey: "asc" } },
          activities: { orderBy: { stableKey: "asc" }, include: { zone: true, schedules: { orderBy: { startsAt: "asc" } } } },
          routeNodes: { orderBy: { stableKey: "asc" } },
          routeEdges: true,
          contentSources: true,
        },
      })
    : null;

  return NextResponse.json({
    data: {
      event: { id: access.event.id, slug: eventSlug, name: access.event.name, publishedCatalogVersionId: access.event.publishedCatalogVersionId },
      versions: versions.map((version) => ({
        id: version.id,
        versionNumber: version.versionNumber,
        status: version.status,
        sourceSummary: version.sourceSummary,
        validationReport: version.validationReport,
        crosswalkStatus: version.crosswalkStatus,
        crosswalkChecksum: version.crosswalkChecksum,
        publishedAt: version.publishedAt?.toISOString() ?? null,
        counts: version._count,
      })),
      selectedVersion: selected
        ? {
            id: selected.id,
            versionNumber: selected.versionNumber,
            status: selected.status,
            sourceSummary: selected.sourceSummary,
            validationReport: selected.validationReport,
            crosswalkStatus: selected.crosswalkStatus,
            crosswalkChecksum: selected.crosswalkChecksum,
            config: selected.config,
            zones: selected.zones,
            activities: selected.activities,
            routeNodes: selected.routeNodes,
            routeEdges: selected.routeEdges,
            contentSources: selected.contentSources,
          }
        : null,
    },
    meta: { persistence: "postgresql" },
  });
});

export const POST = withAdminApiContract(async function POST(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  const access = await authorizeEventRequest(request, eventSlug, ["OWNER", "ADMIN", "EDITOR"]);
  if (!access.authorized) return errorResponse(access.userId ? "FORBIDDEN" : "UNAUTHORIZED", access.userId ? "صلاحية تحرير الكتالوج مطلوبة." : "غير مصرح.", access.userId ? 403 : 401);
  if (!access.event) return errorResponse("EVENT_NOT_FOUND", "الفعالية غير موجودة.", 404);

  const body = await request.json().catch(() => ({}));
  const fromVersionId = typeof body?.fromVersionId === "string" ? body.fromVersionId : access.event.publishedCatalogVersionId;
  const base = fromVersionId
    ? await prisma.catalogVersion.findFirst({
        where: { id: fromVersionId, eventId: access.event.id },
        include: {
          zones: true,
          activities: { include: { schedules: true } },
          routeNodes: true,
          routeEdges: true,
          contentSources: true,
        },
      })
    : await prisma.catalogVersion.findFirst({
        where: { eventId: access.event.id },
        orderBy: { versionNumber: "desc" },
        include: {
          zones: true,
          activities: { include: { schedules: true } },
          routeNodes: true,
          routeEdges: true,
          contentSources: true,
        },
      });
  if (!base) return errorResponse("CATALOG_NOT_FOUND", "لا توجد نسخة أساس لبدء draft.", 409);

  const sourceSummary = typeof body?.sourceSummary === "string" && body.sourceSummary.trim()
    ? body.sourceSummary.trim().slice(0, 240)
    : `مسودة منسوخة من الكتالوج v${base.versionNumber}`;
  const created = await prisma.$transaction(async (tx) => {
    const maxVersion = await tx.catalogVersion.aggregate({ where: { eventId: access.event!.id }, _max: { versionNumber: true } });
    const version = await tx.catalogVersion.create({
      data: {
        eventId: access.event!.id,
        versionNumber: (maxVersion._max.versionNumber ?? 0) + 1,
        status: "DRAFT",
        sourceSummary,
        config: base.config as any,
        createdById: access.userId ?? undefined,
      },
    });
    const sourceIds = new Map<string, string>();
    for (const source of base.contentSources) {
      const copy = await tx.contentSource.create({
        data: {
          catalogVersionId: version.id,
          sourceType: source.sourceType,
          title: source.title,
          locator: source.locator,
          checksum: source.checksum,
          observedAt: source.observedAt,
          validUntil: source.validUntil,
          trustLevel: source.trustLevel,
          reviewStatus: source.reviewStatus,
        },
      });
      sourceIds.set(source.id, copy.id);
    }
    const zoneIds = new Map<string, string>();
    for (const zone of base.zones) {
      const copy = await tx.zone.create({
        data: {
          catalogVersionId: version.id,
          stableKey: zone.stableKey,
          nameAr: zone.nameAr,
          nameEn: zone.nameEn,
          description: zone.description,
          mapX: zone.mapX,
          mapY: zone.mapY,
          capacity: zone.capacity,
          tags: zone.tags,
          popularityWeight: zone.popularityWeight,
          status: zone.status,
          reviewStatus: zone.reviewStatus,
          sourceRefs: zone.sourceRefs.map((sourceId) => sourceIds.get(sourceId)).filter((sourceId): sourceId is string => Boolean(sourceId)),
        },
      });
      zoneIds.set(zone.id, copy.id);
    }
    const activityIds = new Map<string, string>();
    for (const activity of base.activities) {
      const zoneId = zoneIds.get(activity.zoneId);
      if (!zoneId) continue;
      const copy = await tx.activity.create({
        data: {
          catalogVersionId: version.id,
          zoneId,
          stableKey: activity.stableKey,
          nameAr: activity.nameAr,
          nameEn: activity.nameEn,
          descriptionAr: activity.descriptionAr,
          descriptionEn: activity.descriptionEn,
          type: activity.type,
          durationMin: activity.durationMin,
          priceMinCents: activity.priceMinCents,
          priceMaxCents: activity.priceMaxCents,
          ageMin: activity.ageMin,
          ageMax: activity.ageMax,
          familyFriendly: activity.familyFriendly,
          walkingLevel: activity.walkingLevel,
          interests: activity.interests,
          moods: activity.moods,
          accessibilityTags: activity.accessibilityTags,
          popularityWeight: activity.popularityWeight,
          status: activity.status,
          reviewStatus: activity.reviewStatus,
          sourceRefs: activity.sourceRefs.map((sourceId) => sourceIds.get(sourceId)).filter((sourceId): sourceId is string => Boolean(sourceId)),
        },
      });
      activityIds.set(activity.id, copy.id);
      for (const schedule of activity.schedules) {
        await tx.schedule.create({
          data: {
            activityId: copy.id,
            dayOfWeek: schedule.dayOfWeek,
            eventDate: schedule.eventDate,
            startsAt: schedule.startsAt,
            endsAt: schedule.endsAt,
            kind: schedule.kind,
            capacity: schedule.capacity,
            bookingRequired: schedule.bookingRequired,
            status: schedule.status,
          },
        });
      }
    }
    const nodeIds = new Map<string, string>();
    for (const node of base.routeNodes) {
      const copy = await tx.routeNode.create({
        data: {
          catalogVersionId: version.id,
          zoneId: node.zoneId ? zoneIds.get(node.zoneId) : null,
          stableKey: node.stableKey,
          type: node.type,
          label: node.label,
          x: node.x,
          y: node.y,
          accessible: node.accessible,
          description: node.description,
          aliases: node.aliases,
          status: node.status,
        },
      });
      nodeIds.set(node.id, copy.id);
    }
    for (const edge of base.routeEdges) {
      const fromNodeId = nodeIds.get(edge.fromNodeId);
      const toNodeId = nodeIds.get(edge.toNodeId);
      if (!fromNodeId || !toNodeId) continue;
      await tx.routeEdge.create({
        data: {
          catalogVersionId: version.id,
          fromNodeId,
          toNodeId,
          sourceId: edge.sourceId ? sourceIds.get(edge.sourceId) : null,
          distanceM: edge.distanceM,
          walkMin: edge.walkMin,
          accessible: edge.accessible,
          status: edge.status,
        },
      });
    }
    await tx.auditLog.create({
      data: {
        organizationId: access.event!.organizationId,
        actorUserId: access.userId ?? undefined,
        action: "catalog_version.create_draft",
        entityType: "CatalogVersion",
        entityId: version.id,
        afterSummary: { fromVersionId: base.id, fromVersionNumber: base.versionNumber, versionNumber: version.versionNumber },
      },
    });
    return version;
  });

  return NextResponse.json({ data: { id: created.id, versionNumber: created.versionNumber, status: created.status }, meta: { persistence: "postgresql" } }, { status: 201 });
});
