"use client";

import { useState, type FormEvent } from "react";
import { eventTime } from "./activity-updates";
import { adminFetch } from "@/lib/admin-fetch";

export type OperationsZone = { id: string; name: string; capacity?: number | null };
type Update = { id: string; updateType: string; targetId: string | null; createdAt: string; status: string; endsAt: string | null; payload: Record<string, unknown> };

export function CrowdOperations({ eventSlug, timezone, zones, updates, onPublished }: {
  eventSlug: string; timezone: string; zones: OperationsZone[]; updates: Update[]; onPublished: () => void;
}) {
  const [zoneId, setZoneId] = useState("");
  const [people, setPeople] = useState("");
  const [wait, setWait] = useState("");
  const [validFor, setValidFor] = useState("15");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{ key: string; zoneId: string; startsAt: string; endsAt: string; occupiedPeople: number; waitMinutes?: number } | null>(null);
  const zone = zones.find((candidate) => candidate.id === zoneId);
  const canMeasure = Boolean(zone?.capacity);

  function review(event: FormEvent) {
    event.preventDefault();
    if (!canMeasure) return;
    const now = Date.now();
    setPending({
      key: crypto.randomUUID(), zoneId, startsAt: new Date(now).toISOString(),
      endsAt: new Date(now + Number(validFor) * 60_000).toISOString(),
      occupiedPeople: Number(people), ...(wait !== "" ? { waitMinutes: Number(wait) } : {}),
    });
    setMessage("");
    setError("");
  }

  async function publish() {
    if (!pending || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await adminFetch(`/api/v1/events/${encodeURIComponent(eventSlug)}/updates`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": pending.key },
        body: JSON.stringify({
          updateType: "CROWD_OVERRIDE", targetType: "zone", targetId: pending.zoneId,
          startsAt: pending.startsAt, endsAt: pending.endsAt,
          payload: { measurement: "counted", occupiedPeople: pending.occupiedPeople, waitMinutes: pending.waitMinutes },
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message ?? "تعذر نشر القياس.");
      setPending(null);
      setPeople("");
      setWait("");
      setMessage("نُشر القياس. يستخدمه ونيس حتى وقت الانتهاء.");
      onPublished();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر نشر القياس.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="card" aria-labelledby="crowd-operations-title">
    <h2 id="crowd-operations-title">إشغال المناطق ووقت الانتظار</h2>
    <p>سجّل العدّ الميداني. يحسب ونيس الإشغال من السعة المنشورة للمنطقة.</p>
    <ul className="zone-reading-list">
      {zones.map((item) => {
        const reading = updates.find((update) => update.status === "ACTIVE" && update.targetId === item.id &&
          update.updateType === "CROWD_OVERRIDE" && (!update.endsAt || Date.parse(update.endsAt) > Date.now()));
        const measured = reading?.payload.measurement === "counted";
        return <li key={item.id}>
          <strong>{item.name}</strong>
          {reading && typeof reading.payload.level === "number" ? <>
            <span>{Math.round(reading.payload.level * 100)}٪ · {measured ? "عدّ ميداني" : "تقدير المشغّل"}</span>
            {measured && <small>{String(reading.payload.occupiedPeople)} من {String(reading.payload.capacity)} زائرًا</small>}
            {measured && typeof reading.payload.waitMinutes === "number" && <small>انتظار {reading.payload.waitMinutes} د</small>}
            <small>{eventTime(reading.createdAt, timezone)}</small>
          </> : <span>بانتظار قياس</span>}
        </li>;
      })}
    </ul>
    {pending ? <div className="update-preview">
      <h3>راجع القياس</h3>
      <p>{zone?.name} · {pending.occupiedPeople} زائرًا من سعة {zone?.capacity} · ينتهي {eventTime(pending.endsAt, timezone)}</p>
      {pending.waitMinutes !== undefined && <p>الانتظار المسجّل {pending.waitMinutes} د</p>}
      <div className="row">
        <button className="btn primary" type="button" disabled={busy} onClick={publish}>{busy ? "جارٍ النشر…" : "انشر القياس"}</button>
        <button className="btn ghost" type="button" disabled={busy} onClick={() => setPending(null)}>تعديل القياس</button>
      </div>
    </div> : <form onSubmit={review}>
      <div className="activity-update-fields">
        <label htmlFor="measurement-zone">المنطقة<select id="measurement-zone" required value={zoneId} onChange={(event) => setZoneId(event.target.value)}>
          <option value="">اختر منطقة</option>{zones.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label htmlFor="measurement-people">عدد الزوار الآن<input id="measurement-people" type="number" min={0} max={1000000} required value={people} onChange={(event) => setPeople(event.target.value)} /></label>
        <label htmlFor="measurement-wait">الانتظار المرصود (دقائق)<input id="measurement-wait" type="number" min={0} max={240} value={wait} onChange={(event) => setWait(event.target.value)} /></label>
        <label htmlFor="measurement-duration">صالح لمدة (دقائق)<input id="measurement-duration" type="number" min={1} max={60} required value={validFor} onChange={(event) => setValidFor(event.target.value)} /></label>
      </div>
      {zone && <p role="status">{canMeasure ? `السعة المنشورة ${zone.capacity} زائرًا` : "أضف السعة المعتمدة إلى الكتالوج وانشر نسخته."}</p>}
      <button className="btn primary" type="submit" disabled={!canMeasure}>راجع القياس</button>
    </form>}
    {error && <p className="err" role="alert">{error}</p>}
    {message && <p className="ok" role="status">{message}</p>}
  </section>;
}
