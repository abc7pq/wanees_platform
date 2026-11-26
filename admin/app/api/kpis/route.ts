import { NextResponse } from "next/server";
import { checkAuthAsync } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// The visitor broadcast API uses *_count / simulated_* names; the dashboard
// reads the shorter names below. Map once here so the KPI cards stay filled.
function dashboardPayload(data: Record<string, unknown>, zones: { id: string; name: string }[], catalogSeeded: number) {
  return {
    ...data,
    offline: data.offline === true,
    liveSessions: data.liveSessions ?? 0,
    catalogSeeded,
    total_stops: data.total_stops ?? data.planned_stops_count ?? 0,
    diverted: data.diverted ?? data.diverted_planned_stops ?? 0,
    load_balance_pct: data.load_balance_pct ?? data.simulated_load_balance_pct ?? 0,
    peak_reduction_pct: data.peak_reduction_pct ?? data.heuristic_peak_reduction_score_pct ?? 0,
    list: data.list ?? [],
    zones,
  };
}

// ADR-005: COUNT(*) FROM "VisitorSession" WHERE "deletedAt" IS NULL.
async function countCatalogSeeded(): Promise<number> {
  try { return await prisma.visitorSession.count({ where: { deletedAt: null } }); }
  catch { return 0; }
}

export async function GET(req: Request) {
  if (!(await checkAuthAsync(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.VISITOR_API || !process.env.ADMIN_TOKEN) {
    return NextResponse.json({ error: "إعداد VISITOR_API غير مضبوط" }, { status: 500 });
  }
  const catalogSeeded = await countCatalogSeeded();
  try {
    // المصدر الصحيح: /api/admin/broadcast (GET) يعيد list + zones {id,name} بنفس صيغة اللوحة
    const res = await fetch(`${process.env.VISITOR_API}/api/admin/broadcast`, {
      cache: "no-store",
      headers: { "x-admin-token": process.env.ADMIN_TOKEN },
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const data = await res.json();
    let zones = data.zones ?? [];
    // لا جلسات نشطة؟ اعرض كل مناطق الفعالية حتى يبقى زر الزحام قابلًا للاستخدام
    if (!zones.length) {
      try {
        const zr = await fetch(`${process.env.VISITOR_API}/api/zones`, { cache: "no-store" });
        if (zr.ok) zones = (await zr.json()).zones?.map((z: { id: string; name: string }) => ({ id: z.id, name: z.name })) ?? [];
      } catch { /* نكتفي بقائمة فارغة */ }
    }
    return NextResponse.json(dashboardPayload(data, zones, catalogSeeded));
  } catch {
    // واجهة الزائر غير متاحة — نُرجع حالة فارغة بدل 500 حتى تبقى اللوحة مستقرة
    return NextResponse.json(dashboardPayload({
      offline: true, liveSessions: 0, planned_stops_count: 0, diverted_planned_stops: 0,
      simulated_load_balance_pct: 0, heuristic_peak_reduction_score_pct: 0, list: [], zones: [],
    }, [], catalogSeeded));
  }
}
