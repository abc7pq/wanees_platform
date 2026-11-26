import { PITCH_EVENT_SLUG, PITCH_ORGANIZATION_SLUG } from "../../../../../packages/contracts/src/index.ts";
import { NextResponse } from "next/server";
import { checkAuth, checkAuthAsync } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { findOrganizerSession } from "@/lib/organizer-auth";
import { withAdminApiContract } from "@/lib/api-response";
import { enforceAdminRateLimit, isSameOrigin } from "@/lib/request-security";

export const dynamic = "force-dynamic";

function slugify(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function parseDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  const withTimezone = /(?:Z|[+-]\d\d:\d\d)$/i.test(raw) ? raw : `${raw}${raw.length === 16 ? ":00" : ""}+03:00`;
  const date = new Date(withTimezone);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function organizationForWrite(request: Request) {
  if (checkAuth(request)) {
    const organization = await prisma.organization.findUnique({ where: { slug: process.env.WANEES_ORGANIZATION_SLUG ?? "wanees-demo" } });
    return organization ? { organization, actorUserId: null } : null;
  }
  const session = await findOrganizerSession(request);
  if (!session) return null;
  const membership = session.user.memberships.find((item) => item.organization.status === "ACTIVE" && ["OWNER", "ADMIN"].includes(item.role));
  return membership ? { organization: membership.organization, actorUserId: session.user.id } : null;
}

export const GET = withAdminApiContract(async function GET(request: Request) {
  if (!(await checkAuthAsync(request))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: { code: "DATABASE_UNAVAILABLE", message: "قاعدة البيانات غير مفعلة." } }, { status: 503 });
  }

  const durableSession = checkAuth(request) ? null : await findOrganizerSession(request);
  const organizationSlug = durableSession?.user.memberships.find((membership) => membership.organization.status === "ACTIVE")?.organization.slug
    ?? process.env.WANEES_ORGANIZATION_SLUG
    ?? "wanees-demo";
  const organization = await prisma.organization.findUnique({
    where: { slug: organizationSlug },
    include: {
      events: {
        orderBy: { startsAt: "desc" },
        include: {
          venue: true,
          publishedCatalogVersion: { include: {
            zones: { select: { stableKey: true, nameAr: true, capacity: true, sourceRefs: true } },
            contentSources: { where: {
              sourceType: "operator_capacity", reviewStatus: "VERIFIED",
              OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }],
            }, select: { id: true } },
          } },
          _count: { select: { visitorSessions: true, analyticsEvents: true, updates: true } },
        },
      },
    },
  });
  if (!organization) {
    return NextResponse.json({ error: { code: "ORGANIZATION_NOT_FOUND", message: "منظمة WANEES غير موجودة." } }, { status: 404 });
  }

  return NextResponse.json({
    data: {
      organization: { id: organization.id, name: organization.name, slug: organization.slug },
      events: organization.events.map((event) => ({
        id: event.id,
        slug: event.slug,
        name: event.name,
        status: event.status,
        startsAt: event.startsAt.toISOString(),
        endsAt: event.endsAt.toISOString(),
        venue: event.venue ? { id: event.venue.id, name: event.venue.name, timezone: event.venue.timezone } : null,
        publishedCatalogVersion: event.publishedCatalogVersion
          ? {
              id: event.publishedCatalogVersion.id,
              versionNumber: event.publishedCatalogVersion.versionNumber,
              status: event.publishedCatalogVersion.status,
              zones: event.publishedCatalogVersion.zones.map((zone) => ({
                id: zone.stableKey,
                name: zone.nameAr,
                capacity: (event.slug === PITCH_EVENT_SLUG && organizationSlug === PITCH_ORGANIZATION_SLUG)
                  || event.publishedCatalogVersion?.contentSources.some((source) => zone.sourceRefs.includes(source.id)) ? zone.capacity : null,
              })),
            }
          : null,
        counts: event._count,
      })),
    },
    meta: { persistence: "postgresql" },
  });
});

export const POST = withAdminApiContract(async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: { code: "FORBIDDEN", message: "تعذر التحقق من مصدر الطلب." } }, { status: 403 });
  const rate = await enforceAdminRateLimit(request, "event-create", 10);
  if (!rate.allowed) return NextResponse.json({ error: { code: "RATE_LIMITED", message: "انتظر قليلًا قبل إنشاء فعالية أخرى." } }, { status: 429 });
  if (!(await checkAuthAsync(request))) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "غير مصرح." } }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: { code: "DATABASE_UNAVAILABLE", message: "قاعدة البيانات غير مفعلة." } }, { status: 503 });

  const access = await organizationForWrite(request);
  if (!access) return NextResponse.json({ error: { code: "FORBIDDEN", message: "صلاحية مالك أو مدير المنظمة مطلوبة." } }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 160) : "";
  const slug = slugify(typeof body?.slug === "string" ? body.slug : name);
  if (slug === PITCH_EVENT_SLUG && access.organization.slug !== PITCH_ORGANIZATION_SLUG) {
    return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "معرّف العرض التجريبي محجوز." } }, { status: 400 });
  }
  const startsAt = parseDate(body?.startsAt);
  const endsAt = parseDate(body?.endsAt);
  const invalid = name.length < 2 ? "اسم الفعالية مطلوب (حرفان على الأقل)."
    : !slug ? "المعرف العام مطلوب: حروف إنجليزية صغيرة وأرقام وشرطات."
      : !startsAt || !endsAt ? "تاريخا البداية والنهاية مطلوبان."
        : endsAt <= startsAt ? "تاريخ النهاية يجب أن يكون بعد تاريخ البداية."
          : null;
  if (invalid || !startsAt || !endsAt) {
    return NextResponse.json({ error: { code: "INVALID_REQUEST", message: invalid ?? "تاريخا البداية والنهاية مطلوبان." } }, { status: 400 });
  }

  // Visitor URLs carry only the slug, so it must be unique across every organization.
  const slugTaken = new Error("SLUG_TAKEN");
  try {
    const created = await prisma.$transaction(async (tx) => {
      if (await tx.event.findFirst({ where: { slug }, select: { id: true } })) throw slugTaken;
      const venueName =typeof body?.venueName === "string" ? body.venueName.trim().slice(0, 160) : "";
      const venue = venueName
        ? await tx.venue.create({
            data: {
              organizationId: access.organization.id,
              name: venueName,
              slug: slugify(typeof body?.venueSlug === "string" ? body.venueSlug : venueName) || `venue-${Date.now()}`,
              timezone: typeof body?.timezone === "string" ? body.timezone.slice(0, 64) : "Asia/Riyadh",
              address: typeof body?.address === "string" ? body.address.trim().slice(0, 300) : undefined,
            },
          })
        : null;
      const event = await tx.event.create({
        data: {
          organizationId: access.organization.id,
          venueId: venue?.id,
          name,
          slug,
          description: typeof body?.description === "string" ? body.description.trim().slice(0, 2000) : undefined,
          startsAt,
          endsAt,
          status: "DRAFT",
          defaultLocale: typeof body?.defaultLocale === "string" ? body.defaultLocale.slice(0, 16) : "ar-SA",
        },
      });
      const catalog = await tx.catalogVersion.create({
        data: {
          eventId: event.id,
          versionNumber: 1,
          status: "DRAFT",
          sourceSummary: "أُنشئت من مساحة إدارة ونيس",
          config: { walking_speed_m_per_min: 65, min_walk_min: 4, crowd_threshold: 0.75, opening: { from: 1020, to: 1440 } },
          createdById: access.actorUserId ?? undefined,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: access.organization.id,
          actorUserId: access.actorUserId ?? undefined,
          action: "event.create",
          entityType: "Event",
          entityId: event.id,
          afterSummary: { slug, catalogVersionId: catalog.id },
        },
      });
      return { event, catalog };
    });
    return NextResponse.json({ data: { id: created.event.id, slug: created.event.slug, name: created.event.name, catalogVersionId: created.catalog.id, status: created.event.status }, meta: { persistence: "postgresql" } }, { status: 201 });
  } catch (error: unknown) {
    // The code check above can lose a race with a concurrent create; the unique index on
    // Event.slug (migration 20261126150000) then rejects the insert with P2002.
    const uniqueTarget = (error as { code?: string; meta?: { target?: unknown } })?.code === "P2002"
      ? String((error as { meta?: { target?: unknown } }).meta?.target ?? "")
      : "";
    if (error === slugTaken || (uniqueTarget && !/venue/i.test(uniqueTarget))) {
      return NextResponse.json({ error: { code: "EVENT_SLUG_TAKEN", message: "هذا الرابط مستخدم لفعالية أخرى. اختر اسمًا مختلفًا." } }, { status: 409 });
    }
    const message = error instanceof Error && /Unique constraint/i.test(error.message) ? "المعرف مستخدم مسبقًا داخل المنظمة." : "تعذر إنشاء الفعالية.";
    return NextResponse.json({ error: { code: "EVENT_CREATE_FAILED", message } }, { status: message.includes("المعرف") ? 409 : 500 });
  }
});
