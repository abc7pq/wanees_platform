"use client";
import { useEffect, useState } from "react";
import { BrandLogo } from "@/components/Brand";
import { AR_STOP, arCount } from "@/lib/ar-count";

type OpsData = {
  offline: boolean;
  liveSessions: number;
  planned_stops_count: number;
  diverted_planned_stops: number;
  simulated_load_balance_pct: number;
  heuristic_peak_reduction_score_pct: number;
  zones: { zone: string; name: string; planned_stops: number; simulated_crowd_pct: number; saturated: boolean }[];
};

export default function Ops() {
  const [data, setData] = useState<OpsData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    const controller = new AbortController();
    let nextPoll: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const response = await fetch("/api/ops", { signal: controller.signal });
        if (!response.ok) throw new Error("metrics unavailable");
        const latest: OpsData = await response.json();
        if (latest.offline) throw new Error("metrics offline");
        if (!controller.signal.aborted) {
          setData(latest);
          setStatus("ready");
        }
      } catch {
        if (!controller.signal.aborted) setStatus("unavailable");
      } finally {
        if (!controller.signal.aborted) nextPoll = setTimeout(load, 5000);
      }
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(nextPoll);
    };
  }, []);

  return (
    <main className="container ops-page">
      <header className="ops-heading">
        <div>
          <p className="ops-context brand-eyebrow"><BrandLogo height={28} label="ونيس" /><span>عرض تجريبي للقراءة فقط</span></p>
          <h1>لوحة المشغّل</h1>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <a className="ghost-link" style={{ width: "auto" }} href="/ops/theater">مسرح الحركة: مع ونيس وبدونه <span aria-hidden="true">←</span></a>
          <a className="ghost-link" style={{ width: "auto" }} href="/board/boulevard-world-demo">لوحة الموقع الحية <span aria-hidden="true">←</span></a>
          <a className="ghost-link" style={{ width: "auto" }} href="/demo">واجهة الزائر <span aria-hidden="true">←</span></a>
        </div>
      </header>

      {status === "loading" && <p className="guide" role="status">جارٍ تحميل مؤشرات الفعالية…</p>}
      {status === "unavailable" && <p className="guide" role="status">{data ? "تعذر التحديث. تُعرض آخر قراءة متاحة." : "المؤشرات غير متاحة حاليًا. سنعيد المحاولة تلقائيًا."}</p>}

      {data && <>
      <dl className="ops-kpi">
        <div className="kpi"><dt className="lbl">جلسات نشطة ذات مسارات</dt><dd className="num">{data.liveSessions}</dd></div>
        <div className="kpi"><dt className="lbl">توقفات مخططة في المسارات</dt><dd className="num">{data.planned_stops_count}</dd></div>
        <div className="kpi"><dt className="lbl">توازن المحاكاة</dt><dd className="num">{data.simulated_load_balance_pct}%</dd></div>
        <div className="kpi"><dt className="lbl">تقدير تأثير الذروة</dt><dd className="num">{data.heuristic_peak_reduction_score_pct}%</dd></div>
      </dl>

      <h2 className="section-title">توقفات المسارات والزحام المحاكى حسب المنطقة</h2>
      <div className="ops-card">
        {data.zones.map((z) => (
          <div key={z.zone} className={`zone-row${z.saturated ? " saturated" : ""}`}>
            <strong>{z.name}</strong>
            <span>{arCount(z.planned_stops, AR_STOP)}</span>
            <div className="bar" aria-hidden="true"><i style={{ width: `${z.simulated_crowd_pct}%` }} /></div>
            <bdi className="pct">{z.simulated_crowd_pct}%</bdi>
          </div>
        ))}
        {!data.zones.length && <p>لا توجد توقفات مخططة بعد.</p>}
      </div>
      </>}

      <p style={{ color: "var(--dim)", fontSize: 12.5, lineHeight: 1.8, marginTop: 10 }}>
        هذه أرقام تجريبية ومحاكاة للجلسات وتوقفات المسارات المخططة والازدحام. درجة الذروة تقدير إرشادي محسوب بمعادلة تجريبية، وليست قياسًا لخفض فعلي أو لعدد الزوار. يتطلب القياس الواقعي بيانات حية موثوقة.
      </p>
    </main>
  );
}
