import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { allSessions, applyEvents, sessionNow } from "@/lib/session.ts";
import { fmtTime } from "@/engine/route.ts";
import { loadActiveCatalog } from "@/lib/venues.ts";
import { DEMO_METRIC_CONTRACT, heuristicPeakReductionScore } from "@/engine/ops-metrics.ts";
import { computeLoadBalancePct } from "@/engine/coordinator.ts";

export const dynamic = "force-dynamic";

/** Constant-time check; an unset or empty ADMIN_TOKEN never authorizes. */
function adminTokenMatches(value: string | null) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || !value) return false;
  const digest = (input: string) => createHash("sha256").update(input, "utf8").digest();
  return timingSafeEqual(digest(value), digest(expected));
}

/** بوابة الإدارة الداخلية — محمية بـ x-admin-token (لا يُعرَض للزوار) */
export async function GET(req: Request) {
  if (!adminTokenMatches(req.headers.get("x-admin-token"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sessions = allSessions().filter((s) => s.itinerary);
  const zones = new Map<string, { plannedStops: number; crowd: number }>();
  let totalStops = 0, diverted = 0;
  for (const s of sessions) {
    for (const stop of s.itinerary!.stops) {
      totalStops++;
      const z = zones.get(stop.zone) ?? { plannedStops: 0, crowd: 0 };
      z.plannedStops++;
      z.crowd = s.site.crowd(stop.zone, stop.start);
      zones.set(stop.zone, z);
      if (stop.note) diverted++;
    }
  }
  const loadBalance = computeLoadBalancePct(
    [...zones.entries()].map(([zoneId, z]) => ({ zone: zoneId, crowd: z.crowd, plannedStops: z.plannedStops })),
    0.75
  );
  return NextResponse.json({
    offline: false,
    [DEMO_METRIC_CONTRACT.live_sessions_field]: sessions.length,
    [DEMO_METRIC_CONTRACT.planned_stop_count_field]: totalStops,
    diverted_planned_stops: diverted,
    simulated_load_balance_pct: loadBalance,
    [DEMO_METRIC_CONTRACT.heuristic_score_field]: heuristicPeakReductionScore(diverted, loadBalance),
    list: sessions.map((s) => ({
      id: s.id,
      venue: s.site.venueName,
      nowText: fmtTime(sessionNow(s)),
      stops: s.itinerary!.stops.length,
      cost: s.itinerary!.total_cost,
    })),
    zones: [...zones.keys()].map((z) => ({ id: z, name: sessions.find((s) => s.site.zones.get(z))?.site.zones.get(z)?.name ?? z })),
  });
}

export async function POST(req: Request) {
  if (!adminTokenMatches(req.headers.get("x-admin-token"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let events: unknown;
  try {
    ({ events } = await req.json());
  } catch {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }
  if (!Array.isArray(events) || events.length > 100 || events.some((ev) => !ev || typeof ev !== "object" || typeof (ev as { type?: unknown }).type !== "string")) {
    return NextResponse.json({ error: "طلب غير صالح: events يجب أن تكون قائمة أحداث" }, { status: 400 });
  }
  // تحقق من صحة أحداث الزحام قبل التطبيق — منطقة غير موجودة تُرجع 400 لا 500
  const knownZones = new Set(loadActiveCatalog().zones.map((z) => z.id));
  for (const ev of (events ?? []) as Array<{ type?: string; zone?: string }>) {
    if (ev?.type === "crowd_spike" && !knownZones.has(ev.zone ?? "")) {
      return NextResponse.json({ error: `منطقة غير معروفة: ${ev.zone ?? "(فارغة)"} — استخدم معرف المنطقة` }, { status: 400 });
    }
  }
  const sessions = allSessions();
  const evList = (events ?? []) as import("@/engine/types.ts").CrowdEvent[];
  for (const s of sessions) {
    applyEvents(s, evList, sessionNow(s));
  }
  return NextResponse.json({ ok: true, touched: sessions.length });
}
