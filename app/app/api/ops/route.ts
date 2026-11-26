// لوحة المشغّل — تقرأ الجلسات والمسارات الفعلية من PostgreSQL (نفس مخزن واجهة الزائر)
// نفس شكل الاستجابة السابق حتى تبقى اللوحة والlabels كما هي؛ المصدر صار المتجر الدائم.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { Site } from "@/engine/site.ts";
import { heuristicPeakReductionScore } from "@/engine/ops-metrics";
import { computeLoadBalancePct } from "@/engine/coordinator";
import { loadPublishedEventCatalog } from "@/lib/db-catalog";

export const dynamic = "force-dynamic";

const DEMO_EVENT_SLUG = "boulevard-world-demo";

type OpsPayload = {
  offline: boolean;
  liveSessions: number;
  planned_stops_count: number;
  diverted_planned_stops: number;
  simulated_load_balance_pct: number;
  heuristic_peak_reduction_score_pct: number;
  zones: { zone: string; name: string; planned_stops: number; simulated_crowd_pct: number; saturated: boolean }[];
  now_hour: number;
  source: string;
};

function emptyPayload(offline: boolean, source: string): OpsPayload {
  return {
    offline,
    liveSessions: 0,
    planned_stops_count: 0,
    diverted_planned_stops: 0,
    simulated_load_balance_pct: 0,
    heuristic_peak_reduction_score_pct: 0,
    zones: [],
    now_hour: new Date().getUTCHours() + 3, // احتياطيًا توقيت الرياض حين لا جلسات
    source,
  };
}

/** دقائق اليوم من الطابع الزمني لخطط المسار (تُبنى من "الآن" بالتوقيت UTC) */
function venueMinutes(date: Date) {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(emptyPayload(true, "no_database"));
  }

  const catalogResult = await loadPublishedEventCatalog(DEMO_EVENT_SLUG);
  if (!catalogResult) {
    return NextResponse.json(emptyPayload(true, "catalog_unavailable"));
  }
  const site = new Site(catalogResult.catalog);

  const activeSessions = await prisma.visitorSession.findMany({
    where: {
      deletedAt: null,
      expiresAt: { gt: new Date() },
      eventId: catalogResult.eventId,
    },
    select: { id: true },
  });
  const sessionIds = activeSessions.map((session) => session.id);

  // مسار نشط واحد لكل جلسة (الإنشاءات الأقدم تُعلَّم superseded)
  const itineraries = sessionIds.length
    ? await prisma.itinerary.findMany({
        where: {
          sessionId: { in: sessionIds },
          eventId: catalogResult.eventId,
          // Sessions stay on the catalog version they started with; a republish must not drop them from the board.
          status: "active",
        },
        select: {
          id: true,
          sessionId: true,
          items: {
            select: {
              startsAt: true,
              reasonCodes: true,
              activity: { select: { zone: { select: { stableKey: true, nameAr: true } } } },
            },
          },
        },
      })
    : [];

  const zones = new Map<string, { plannedStops: number; crowd: number; name: string }>();
  let diverted = 0;
  let totalStops = 0;
  let nowMinuteSum = 0;
  let nowMinuteCount = 0;

  for (const itinerary of itineraries) {
    for (const item of itinerary.items) {
      const zoneKey = item.activity.zone.stableKey;
      const zoneName = item.activity.zone.nameAr;
      const startMinute = venueMinutes(item.startsAt);
      totalStops += 1;
      const zone = zones.get(zoneKey) ?? { plannedStops: 0, crowd: 0, name: zoneName };
      zone.plannedStops += 1;
      zone.crowd = site.crowd(zoneKey, startMinute);
      zones.set(zoneKey, zone);
      const note = item.reasonCodes.join(" ");
      if (note.includes("بديل") || note.includes("تأخّر")) diverted += 1;
      nowMinuteSum += startMinute;
      nowMinuteCount += 1;
    }
  }

  // ساعة «الآن» عند الزوار: متوسط ساعة خططهم الحالية — لا ساعة السيرفر
  const nowHour = nowMinuteCount
    ? Math.floor(nowMinuteSum / nowMinuteCount / 60) % 24
    : new Date().getUTCHours() + 3;

  const rows = [...zones.entries()]
    .map(([zoneId, v]) => ({
      zone: zoneId,
      name: v.name,
      planned_stops: v.plannedStops,
      simulated_crowd_pct: Math.round(v.crowd * 100),
      saturated: v.crowd > 0.75,
    }))
    .sort((a, b) => b.planned_stops - a.planned_stops);

  // الأثر: موازنة الحمل من منسّق الحركة (مصدر واحد للحقيقة) — نفس المعادلة السابقة
  const loadBalance = computeLoadBalancePct(
    [...zones.entries()].map(([zoneId, v]) => ({ zone: zoneId, crowd: v.crowd, plannedStops: v.plannedStops })),
    0.75
  );

  const payload: OpsPayload = {
    offline: false,
    liveSessions: itineraries.length,
    planned_stops_count: totalStops,
    diverted_planned_stops: diverted,
    simulated_load_balance_pct: loadBalance,
    heuristic_peak_reduction_score_pct: heuristicPeakReductionScore(diverted, loadBalance),
    zones: rows,
    now_hour: nowHour,
    source: "postgresql",
  };
  return NextResponse.json(payload);
}
