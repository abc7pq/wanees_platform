"use client";
import { useEffect, useState } from "react";
import { Topbar } from "../../dashboard";
import { IconCheck, IconPlus } from "../../icons";

type Act = {
  id: string; name: string; zone: string; type: string; duration_min: number;
  price: number; family: boolean; min_age?: number; interests: string[]; moods: string[];
  popularity: number;
  schedule: { type: "slots"; slots: number[] } | { type: "continuous"; from: number; to: number };
};

const EMPTY: Act = {
  id: "", name: "", zone: "", type: "experience", duration_min: 30, price: 0,
  family: true, interests: [], moods: [], popularity: 0.6,
  schedule: { type: "continuous", from: 1020, to: 1400 },
};

export default function Editor({ venueId }: { venueId: string }) {
  const [cat, setCat] = useState<{ site: { name: string }; zones: { id: string; name: string }[]; activities: Act[] } | null>(null);
  const [form, setForm] = useState<Act | null>(null);
  const [isNew, setIsNew] = useState(true);
  const [msg, setMsg] = useState("");

  const load = () => fetch(`/api/venues/${venueId}`)
    .then((r) => {
      if (r.status === 401) { location.href = "/login"; return null; }
      return r.json();
    })
    .then((d) => { if (d) setCat(d); })
    .catch(() => setMsg("تعذر تحميل الأنشطة"));
  useEffect(() => { load(); }, [venueId]);

  const save = async () => {
    if (!form) return;
    if (!form.id.trim() || !form.name.trim() || !form.zone) {
      setMsg("المعرف والاسم والمنطقة مطلوبة");
      return;
    }
    const res = await fetch(`/api/venues/${venueId}`, {
      method: isNew ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    }).catch(() => null);
    if (res?.ok) { setMsg(form.id ? "حُفظ التعديل ✅" : "أُضيف النشاط ✅"); setForm(null); load(); }
    else setMsg(res ? ((await res.json().catch(() => ({}))).error ?? "فشل الحفظ") : "تعذر الاتصال بالخادم");
  };
  const del = async (id: string, name: string) => {
    if (!confirm(`حذف «${name}» نهائيًا؟`)) return;
    const res = await fetch(`/api/venues/${venueId}?act=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) { setMsg(`حُذف «${name}»`); load(); }
    else setMsg("فشل الحذف");
  };

  const f = (k: keyof Act, v: unknown) => setForm({ ...form!, [k]: v });

  return (
    <div className="wrap">
      <Topbar current="venues" />
      <main id="main-content" className="main-content" tabIndex={-1}>
      <h1 className="sr-only">محرر أنشطة الفعالية</h1>
      <div className="topbar" style={{ border: "none", padding: "4px 0" }}>
        <h2 style={{ fontSize: 18 }}>{cat?.site?.name ?? "…"}</h2>
        <a className="navlink" href="/venues">← كل الفعاليات</a>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>الأنشطة ({cat?.activities?.length ?? 0})</h2>
          <button type="button" className="btn small" onClick={() => { setForm({ ...EMPTY }); setIsNew(true); setMsg(""); }}><IconPlus size={14} /> نشاط جديد</button>
        </div>
        <table className="responsive-table" style={{ marginTop: 10 }}>
          <caption className="sr-only">أنشطة الفعالية</caption>
          <thead><tr><th scope="col">الاسم</th><th scope="col">المنطقة</th><th scope="col">النوع</th><th scope="col">المدة</th><th scope="col">السعر</th><th scope="col">عائلي</th><th scope="col">الإجراء</th></tr></thead>
          <tbody>
            {(cat?.activities ?? []).map((a) => (
              <tr key={a.id}>
                <td data-label="الاسم">{a.name}</td>
                <td data-label="المنطقة" style={{ fontSize: 12 }}>{cat?.zones.find((z) => z.id === a.zone)?.name ?? a.zone}</td>
                <td data-label="النوع" style={{ fontSize: 12 }}>{a.type}</td>
                <td data-label="المدة">{a.duration_min}د</td>
                <td data-label="السعر">{a.price}</td>
                <td data-label="عائلي">{a.family ? <IconCheck size={15} className="ico-check" /> : "—"}</td>
                <td className="row actions-cell" data-label="الإجراء" style={{ gap: 6 }}>
                  <button type="button" className="btn small ghost" onClick={() => { setForm(a); setIsNew(false); setMsg(""); }}>تعديل</button>
                  <button type="button" className="btn small danger" onClick={() => del(a.id, a.name)}>حذف</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {msg && !form && <div className="ok" role="status" aria-live="polite" style={{ marginTop: 10 }}>{msg}</div>}
      </div>

      {form && (
        <form className="card" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <h2>{!isNew ? `تعديل: ${form.name}` : "نشاط جديد"}</h2>
          <div className="grid2">
            <div><label htmlFor="activity-name">الاسم</label><input id="activity-name" value={form.name} onChange={(e) => f("name", e.target.value)} /></div>
            <div><label htmlFor="activity-id">المعرف (english_id)</label><input id="activity-id" value={form.id} disabled={!isNew} onChange={(e) => f("id", e.target.value.replace(/\s+/g, "_").toLowerCase())} /></div>
            <div><label htmlFor="activity-zone">المنطقة</label>
              <select id="activity-zone" value={form.zone} onChange={(e) => f("zone", e.target.value)}>
                <option value="">— اختر —</option>
                {(cat?.zones ?? []).map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            </div>
            <div><label htmlFor="activity-type">النوع</label>
              <select id="activity-type" value={form.type} onChange={(e) => f("type", e.target.value)}>
                {["show","ride","food","culture","game","shopping","experience","horror","wildlife","water","sport","kids"].map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div><label htmlFor="activity-duration">المدة (دقيقة)</label><input id="activity-duration" type="number" value={form.duration_min} onChange={(e) => f("duration_min", +e.target.value)} /></div>
            <div><label htmlFor="activity-price">السعر (ريال)</label><input id="activity-price" type="number" value={form.price} onChange={(e) => f("price", +e.target.value)} /></div>
            <div><label htmlFor="activity-popularity">شعبية 0–1</label><input id="activity-popularity" type="number" step="0.05" min="0" max="1" value={form.popularity} onChange={(e) => f("popularity", +e.target.value)} /></div>
            <div><label htmlFor="activity-min-age">العمر الأدنى (اتركه فارغًا إن لا يوجد)</label><input id="activity-min-age" type="number" value={form.min_age ?? ""} onChange={(e) => f("min_age", e.target.value === "" ? undefined : +e.target.value)} /></div>
            <div><label htmlFor="activity-interests">الاهتمامات (فاصلة بينها)</label><input id="activity-interests" value={form.interests.join("، ")} onChange={(e) => f("interests", e.target.value.split(/[،,]/).map((s) => s.trim()).filter(Boolean))} /></div>
            <div><label htmlFor="activity-moods">الأمزجة (فاصلة)</label><input id="activity-moods" value={form.moods.join("، ")} onChange={(e) => f("moods", e.target.value.split(/[،,]/).map((s) => s.trim()).filter(Boolean))} /></div>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <label htmlFor="activity-family" style={{ margin: 0 }}><input id="activity-family" type="checkbox" checked={form.family} onChange={(e) => f("family", e.target.checked)} style={{ width: "auto" }} /> مناسب للأطفال</label>
          </div>
          {msg && <div className="ok">{msg}</div>}
          <div className="row" style={{ marginTop: 14 }}>
            <button type="submit" className="btn">حفظ</button>
            <button type="button" className="btn ghost" onClick={() => setForm(null)}>إلغاء</button>
          </div>
        </form>
      )}
      </main>
    </div>
  );
}
