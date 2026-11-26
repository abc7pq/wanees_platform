import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeEventRequest } from "@/lib/catalog-auth";
import { withAdminApiContract } from "@/lib/api-response";
import { projectDryRun, UnknownZoneError } from "@wanees/engine/dry-run";
import { loadPublishedEventCatalog } from "@wanees/engine/db-catalog";
import { getEventClock } from "@wanees/engine/event-clock";
import type { IncentiveDomain } from "@wanees/engine/incentives/types";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventSlug: string }> };

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function incentiveDomainFromRow(
  row: {
    id: string;
    kind: IncentiveDomain["kind"];
    titleAr: string;
    valueLabelAr: string;
    reasonAr: string;
    valueCents: number;
    priority: number;
    trigger: IncentiveDomain["trigger"];
    scopeTarget: IncentiveDomain["scopeTarget"];
    scopeKey: string | null;
    minCrowdLevel: number | null;
    redirectZoneKey: string | null;
    endsAt: Date | null;
    locationLabelAr: string | null;
    perVisitorCap: number;
  },
  claimsCount: number,
): IncentiveDomain {
  return {
    id: row.id,
    kind: row.kind,
    titleAr: row.titleAr,
    valueLabelAr: row.valueLabelAr,
    reasonAr: row.reasonAr,
    valueCents: row.valueCents,
    priority: row.priority,
    trigger: row.trigger,
    scopeTarget: row.scopeTarget,
    scopeKey: row.scopeKey,
    minCrowdLevel: row.minCrowdLevel,
    redirectZoneKey: row.redirectZoneKey,
    endsAt: row.endsAt,
    locationLabelAr: row.locationLabelAr,
    perVisitorCap: row.perVisitorCap,
    claimsCount,
  };
}

/**
 * معاينة جافة لأثر تجاوزات الازدحام — read-only، لا يكتب شيئًا ولا يطلب مفتاح idempotency.
 * تُعيد committed:false دائمًا وتُسقط الأثر على نسخة Site جديدة بلا طفرة.
 * مصادقة المشغّل (OWNER/ADMIN/OPERATOR) عبر authorizeEventRequest، بدل حارس x-admin-token.
 */
export const POST = withAdminApiContract(async function POST(request: Request, context: Context) {
  const { eventSlug } = await context.params;
  const access = await authorizeEventRequest(request, eventSlug, ["OWNER", "ADMIN", "OPERATOR"]);
  if (!access.authorized) {
    return errorResponse(access.userId ? "FORBIDDEN" : "UNAUTHORIZED", "صلاحية المشغّل مطلوبة للمعاينة.", access.userId ? 403 : 401);
  }
  if (!access.event) return errorResponse("EVENT_NOT_FOUND", "الفعالية غير موجودة ضمن المنظمة الحالية.", 404);
  if (!process.env.DATABASE_URL) return errorResponse("DATABASE_UNAVAILABLE", "قاعدة البيانات غير مفعلة.", 503);

  const catalogResult = await loadPublishedEventCatalog(eventSlug);
  // Slugs are unique per organization only: never preview another tenant's catalog.
  if (!catalogResult || catalogResult.eventId !== access.event.id) return errorResponse("EVENT_NOT_FOUND", "الفعالية أو كتالوجها المنشور غير موجود.", 404);

  const body = (await request.json().catch(() => null)) as
    | { crowdOverrides?: unknown; nowMinute?: unknown }
    | null;
  const overridesRaw = Array.isArray(body?.crowdOverrides) ? body.crowdOverrides : [];

  const clock = getEventClock({
    startsAt: catalogResult.eventStartsAt,
    endsAt: catalogResult.eventEndsAt,
    timezone: catalogResult.venueTimezone,
    openingFrom: catalogResult.catalog.site.opening.from,
    openingTo: catalogResult.catalog.site.opening.to,
  });
  const minute = typeof body?.nowMinute === "number" ? body.nowMinute : clock.nowMinute;

  const overrides = overridesRaw.map((raw) => {
    const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    return {
      zone: typeof record.zone === "string" ? record.zone : "",
      level: typeof record.level === "number" ? record.level : 0,
    };
  });

  const now = new Date();
  const rows = await prisma.incentive.findMany({
    where: {
      eventId: catalogResult.eventId,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ],
    },
    include: { _count: { select: { claims: true } } },
  });
  const incentives = rows.map((row) => incentiveDomainFromRow(row, row._count.claims));

  try {
    const projection = projectDryRun(catalogResult.catalog, minute, overrides, incentives);
    return NextResponse.json(
      { data: projection, meta: { persistence: "postgresql", readOnly: true } },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof UnknownZoneError) {
      return errorResponse("UNKNOWN_ZONE", error.message, 400);
    }
    throw error;
  }
});
