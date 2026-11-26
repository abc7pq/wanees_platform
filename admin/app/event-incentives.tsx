"use client";

import { useEffect, useState, type FormEvent } from "react";
import { eventTime } from "./activity-updates";
import type { OperationsZone } from "./crowd-operations";

type Offer = { id: string; titleAr: string; valueLabelAr: string; locationLabelAr: string | null; endsAt: string | null; claimsCount: number };

export function EventIncentives({ eventSlug, timezone, zones }: { eventSlug: string; timezone: string; zones: OperationsZone[] }) {
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [kind, setKind] = useState("FREE_ITEM");
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [location, setLocation] = useState("");
  const [zone, setZone] = useState("");
  const [minutes, setMinutes] = useState("60");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const path = `/api/v1/events/${encodeURIComponent(eventSlug)}/incentives`;

  async function refresh(signal?: AbortSignal) {
    const result = await fetch(path, { signal });
    if (!result.ok) throw new Error("تعذر تحميل الحوافز.");
    const payload = await result.json();
    if (!signal?.aborted) setOffers(payload.data ?? []);
  }

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal).catch(() => {
      if (!controller.signal.aborted) setError("تعذر تحميل الحوافز.");
    });
    return () => controller.abort();
  }, [path]);

  async function publish(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(path, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind, titleAr: title, valueLabelAr: value, reasonAr: reason, valueCents: 0,
          locationLabelAr: location, endsAt: new Date(Date.now() + Number(minutes) * 60_000).toISOString(),
          ...(zone ? { trigger: "CROWD_OVERRIDE", redirectZoneKey: zone } : {}),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "تعذر نشر الحافز.");
      setTitle(""); setValue(""); setReason(""); setLocation("");
      setNotice("نُشر الحافز للزوار المؤهلين.");
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر نشر الحافز.");
    } finally { setPending(false); }
  }

  async function expire(id: string) {
    if (!window.confirm("إنهاء الحافز يوقف عرضه للزوار فورًا. متابعة؟")) return;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`${path}/${encodeURIComponent(id)}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ endsAt: new Date().toISOString() }),
      });
      if (!response.ok) throw new Error("تعذر إنهاء الحافز.");
      await refresh();
      setNotice("انتهى عرض الحافز.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر إنهاء الحافز.");
    } finally { setPending(false); }
  }

  return <section className="card" aria-labelledby="event-incentives-title">
    <h2 id="event-incentives-title">حوافز الزوار</h2>
    <p>انشر الحوافز التي يستطيع فريق الموقع تنفيذها. حدد مكان الاستفادة ووقت الانتهاء.</p>
    <form onSubmit={publish}>
      <div className="activity-update-fields">
        <label htmlFor="offer-kind">النوع<select id="offer-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="FREE_ITEM">هدية</option><option value="DISCOUNT">خصم</option><option value="PRIORITY_ENTRY">أولوية دخول</option><option value="FREE_ACTIVITY">نشاط مجاني</option><option value="CREDIT">رصيد</option>
        </select></label>
        <label htmlFor="offer-title">اسم الحافز<input id="offer-title" required maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label htmlFor="offer-value">القيمة أو الشروط<input id="offer-value" required maxLength={120} value={value} onChange={(e) => setValue(e.target.value)} /></label>
        <label htmlFor="offer-reason">سبب ظهور الحافز<input id="offer-reason" required maxLength={160} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <label htmlFor="offer-location">مكان الاستفادة<input id="offer-location" required maxLength={120} value={location} onChange={(e) => setLocation(e.target.value)} /></label>
        <label htmlFor="offer-redirect">منطقة البديل<select id="offer-redirect" value={zone} onChange={(e) => setZone(e.target.value)}>
          <option value="">متاح في الفعالية</option>{zones.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label htmlFor="offer-expiry">صالح لمدة (دقائق)<input id="offer-expiry" type="number" min={1} max={1440} required value={minutes} onChange={(e) => setMinutes(e.target.value)} /></label>
      </div>
      <button className="btn primary" disabled={pending} type="submit">انشر الحافز</button>
    </form>
    {error && <p className="err" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <ul className="zone-reading-list">
      {(offers ?? []).map((offer) => {
        const active = !offer.endsAt || Date.parse(offer.endsAt) > Date.now();
        return <li key={offer.id}>
          <strong>{offer.titleAr}</strong>
          <span>{offer.valueLabelAr}</span>
          <small>{offer.locationLabelAr}</small>
          {offer.endsAt && <small>{eventTime(offer.endsAt, timezone)}</small>}
          <small>{offer.claimsCount === 1 ? "طلب استفادة واحد" : offer.claimsCount === 2 ? "طلبا استفادة" : `${offer.claimsCount} طلبات استفادة`}</small>
          {active ? <button type="button" className="btn ghost" disabled={pending} onClick={() => expire(offer.id)}>إنهاء الحافز</button> : <small>منتهٍ</small>}
        </li>;
      })}
    </ul>
  </section>;
}
