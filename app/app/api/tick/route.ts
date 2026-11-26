import { NextResponse } from "next/server";
import { getSession, sessionNow } from "@/lib/session";
import { buildRoute } from "@/engine/route.ts";

export const dynamic = "force-dynamic";

/** مراقب الزحام: يفحص المناطق القادمة في المسار ويقترح بديلًا عند التشبع */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("session") ?? "";
  const s = getSession(id);
  if (!s || !s.itinerary) return NextResponse.json({ alert: null });

  const now = sessionNow(s);
  const threshold = s.site.crowdThreshold;
  const upcoming = s.itinerary.stops.filter((x) => x.start > now).slice(0, 2);

  for (const stop of upcoming) {
    const mid = stop.start + 15;
    const level = s.site.crowd(stop.zone, mid);
    if (level > threshold) {
      // ابحث عن بديل: نفس النوع/الاهتمامات، منطقة أقل ازدحامًا، يلائم الوقت
      const act = s.site.activities.get(stop.act_id)!;
      const usedIds = new Set(s.itinerary!.stops.map((x) => x.act_id));
      let best: { id: string; name: string; zone: string; price: number; duration_min: number } | null = null;
      let bestScore = -Infinity;
      for (const [aid, cand] of s.site.activities) {
        if (aid === act.id || usedIds.has(aid) || cand.zone === act.zone) continue;
        if (s.profile.companions_kids && !cand.family) continue;
        // يلائم الفتحة الزمنية تقريبًا
        const overlapOk = Math.abs(cand.duration_min - act.duration_min) <= 20;
        if (!overlapOk) continue;
        const load = s.site.zoneLoadFactor(cand.zone, mid);
        const match = cand.interests.filter((i) => act.interests.includes(i)).length * 2
          + (cand.moods.includes(act.moods[0] ?? "") ? 2 : 0)
          - load * 10;
        if (match > bestScore) {
          bestScore = match;
          best = { id: aid, name: cand.name, zone: cand.zone, price: cand.price, duration_min: cand.duration_min };
        }
      }
      if (best) {
        return NextResponse.json({
          alert: {
            stop_act: stop.act_id,
            stop_name: stop.name,
            zone: s.site.zones.get(stop.zone)!.name,
            level,
            suggestion: best,
            text: `⚠️ «${stop.name}» في ${s.site.zones.get(stop.zone)!.name} — زحام متوقع ${Math.round(level * 100)}٪ وقتها. أنسب بديل: «${best.name}» بنفس الوقت تقريبًا.`,
          },
        });
      }
    }
  }
  return NextResponse.json({ alert: null });
}
