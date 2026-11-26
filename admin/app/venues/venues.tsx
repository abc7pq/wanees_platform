"use client";
import { useEffect, useState } from "react";
import { Topbar } from "../dashboard";

type V = { id: string; name: string; file: string; activities: number };

export default function Venues() {
  const [venues, setVenues] = useState<V[]>([]);
  const [active, setActive] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");

  const load = () => fetch("/api/venues").then((r) => r.json()).then((d) => { setVenues(d.venues ?? []); setActive(d.active); });
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!name.trim()) return;
    const id = "venue_" + Math.random().toString(36).slice(2, 8);
    const res = await fetch("/api/venues", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, name: name.trim() }) });
    if (res.ok) { setMsg(`أضيفت «${name}» — افتحها وأضف أنشطتها`); setName(""); load(); }
    else setMsg((await res.json().catch(() => ({}))).error ?? "فشلت الإضافة");
  };
  const activate = async (id: string) => {
    const res = await fetch("/api/venues", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    if (res.ok) { setMsg(`أصبحت الفعالية معروضة للزوار`); load(); }
    else setMsg("فشل التفعيل");
  };

  return (
    <div className="wrap">
      <Topbar current="venues" />
      <main id="main-content" className="main-content" tabIndex={-1}>
      <div className="card">
        <h1>الفعاليات</h1>
        <table className="responsive-table">
          <caption className="sr-only">الفعاليات والأنشطة المنشأة</caption>
          <thead><tr><th scope="col">الفعالية</th><th scope="col">المعرف</th><th scope="col">الأنشطة</th><th scope="col">الحالة</th><th scope="col">الإجراء</th></tr></thead>
          <tbody>
            {venues.map((v) => (
              <tr key={v.id}>
                <td data-label="الفعالية"><a href={`/venues/${v.id}`} style={{ color: "var(--teal)" }}>{v.name}</a></td>
                <td className="mono" data-label="المعرف">{v.id}</td>
                <td data-label="الأنشطة">{v.activities}</td>
                <td data-label="الحالة">{v.id === active ? <span className="badge on">الفعالية المعروضة للزوار</span> : <span className="badge">مؤرشفة</span>}</td>
                <td className="actions-cell" data-label="الإجراء">{v.id !== active && <button type="button" className="btn small ghost" onClick={() => activate(v.id)}>عرض للزوار</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {msg && <div className="ok" role="status" aria-live="polite">{msg}</div>}
      </div>
      <div className="card">
        <h2>إضافة فعالية جديدة</h2>
        <div className="row">
          <label className="sr-only" htmlFor="new-venue-name">اسم الفعالية الجديدة</label>
          <input id="new-venue-name" style={{ maxWidth: 340 }} placeholder="اسم الفعالية — مثال: موسم الرياض 2027" value={name}
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <button type="button" className="btn" onClick={add}>إضافة</button>
        </div>
        <p style={{ color: "var(--dim)", fontSize: 12.5, marginTop: 10 }}>
          الفعالية الجديدة تُنشأ بخريطة مناطق بوليفارد وورلد نفسها — عدّل المناطق لاحقًا من ملفها، وأضف أنشطتها من هنا.
        </p>
      </div>
      </main>
    </div>
  );
}
