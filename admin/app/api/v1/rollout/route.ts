import { NextResponse } from "next/server";
import { checkAuthAsync } from "@/lib/auth";
import { stageOf, operationalImpact, type SuccessStage } from "@wanees/engine/eval";
import { withAdminApiContract } from "@/lib/api-response";

export const dynamic = "force-dynamic";

/**
 * rolloutStage — read-only إسقاط على SuccessStage (10|30|60)، لا نوع جديد.
 *
 * مصدر الحقيقة الوحيد هو دالة الأثر التشغيلي في المحرّك
 * (packages/engine/src/eval.ts: operationalImpact → stageOf)، فيشترك القياس الحيّ
 * وتقييم المحرّك في enum واحد بدل سطحين متناقضين. اليوم الأثر التشغيلي هو البعد
 * الوحيد القابل للقياس حيّا (موازنة الحمل + خفض الذروة من بثّ الزائر)؛ عند اكتمال
 * خط قياس Q/U/S/O الحيّ يتحوّل overallStage إلى min(الأربعة) ويبقى rolloutStage
 * إسقاطًا عليه — دون تغيير اسم الحقل أو الـ enum.
 */

function pct(data: Record<string, unknown>, ...keys: string[]): number {
  for (const k of keys) {
    const v = data[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return 0;
}

export const GET = withAdminApiContract(async function GET(req: Request) {
  if (!(await checkAuthAsync(req))) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "صلاحية المشغّل مطلوبة." } },
      { status: 401 },
    );
  }

  let loadBalancePct = 0;
  let peakReductionPct = 0;
  let offline = false;

  if (process.env.VISITOR_API && process.env.ADMIN_TOKEN) {
    try {
      const res = await fetch(`${process.env.VISITOR_API}/api/admin/broadcast`, {
        cache: "no-store",
        headers: { "x-admin-token": process.env.ADMIN_TOKEN },
      });
      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>;
        loadBalancePct = pct(data, "load_balance_pct", "simulated_load_balance_pct");
        peakReductionPct = pct(data, "peak_reduction_pct", "heuristic_peak_reduction_score_pct");
      } else {
        offline = true;
      }
    } catch {
      offline = true;
    }
  } else {
    offline = true;
  }

  const impact = operationalImpact(loadBalancePct, peakReductionPct);
  const rolloutStage: SuccessStage = stageOf(impact);

  return NextResponse.json(
    {
      data: {
        rolloutStage,
        overallStage: rolloutStage,
        operationalImpact: impact,
        loadBalancePct,
        peakReductionPct,
      },
      meta: { readOnly: true, source: "engine:operationalImpact", offline },
    },
    { status: 200 },
  );
});
