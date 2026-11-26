"use client";
import { useEffect, useState, type FormEvent } from "react";
import { arCount, COUNT } from "@/lib/arabic-labels";
import { adminFetch } from "@/lib/admin-fetch";

type Impact = { state: "loading" } | { state: "ready"; visitors: number } | { state: "unavailable" };

function impactText(impact: Impact, closure: boolean) {
  if (impact.state === "loading") return "جارٍ حساب الأثر…";
  if (impact.state === "unavailable") return "تعذر حساب الأثر الآن. يمكنك النشر مع ذلك.";
  if (!impact.visitors) return "لا يوجد زوار لديهم هذا النشاط في مساراتهم خلال هذه الفترة.";
  return `يصل إلى ${arCount(impact.visitors, COUNT.visitors)} لديهم هذا النشاط في مساراتهم خلال الفترة، ${closure ? "ويُعاد ترتيب مساراتهم فورًا" : "ويختارون بين البديل والإبقاء على مسارهم"}.`;
}

export type UpdateActivity = { stableKey: string; nameAr: string; status: string; zone?: { stableKey: string; nameAr: string } | null };

/** Readable label for an IANA zone; the organizer never needs the raw identifier. */
export function timezoneLabel(timezone: string) {
  if (timezone === "Asia/Riyadh") return "بتوقيت الرياض";
  try {
    const name = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", { timeZone: timezone, timeZoneName: "longGeneric" })
      .formatToParts(new Date()).find((part) => part.type === "timeZoneName")?.value;
    return name ? `بتوقيت ${name}` : timezone;
  } catch {
    return timezone;
  }
}

/** Activities grouped by zone so same-named activities in different zones stay distinguishable. */
function groupByZone(activities: UpdateActivity[]) {
  const groups = new Map<string, { label: string; items: UpdateActivity[] }>();
  for (const activity of activities) {
    const key = activity.zone?.stableKey ?? "";
    const group = groups.get(key) ?? { label: activity.zone?.nameAr ?? "بدون منطقة", items: [] };
    group.items.push(activity);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, group]) => ({ key, label: group.label, items: group.items.sort((a, b) => a.nameAr.localeCompare(b.nameAr, "ar")) }))
    .sort((a, b) => a.label.localeCompare(b.label, "ar"));
}

function activityLabel(activity: UpdateActivity | undefined) {
  if (!activity) return "";
  return activity.zone?.nameAr ? `${activity.nameAr} — ${activity.zone.nameAr}` : activity.nameAr;
}

export function eventTime(timestamp: string, timezone: string) {
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
    timeZone: timezone, dateStyle: "short", timeStyle: "short",
  }).format(new Date(timestamp));
}

type Draft = {
  updateType: "DELAY" | "CLOSURE";
  targetType: "activity";
  targetId: string;
  startsAt: string;
  endsAt: string;
  payload: { reason: string; minutes?: number };
};

export function ActivityUpdates({ event, activities, onPublished }: {
  event: { slug: string; name: string; timezone: string };
  activities: UpdateActivity[];
  onPublished: () => void;
}) {
  const [type, setType] = useState<Draft["updateType"]>("DELAY");
  const [target, setTarget] = useState("");
  const [minutes, setMinutes] = useState("25");
  const [reason, setReason] = useState("");
  const [startsIn, setStartsIn] = useState("0");
  const [validFor, setValidFor] = useState("30");
  const [review, setReview] = useState<{ update: Draft; key: string } | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [impact, setImpact] = useState<Impact>({ state: "loading" });
  const available = activities.filter((activity) => activity.status === "ACTIVE");
  const catalogReady = activities.length > 0;

  useEffect(() => {
    if (activities.length && !activities.some((activity) => activity.stableKey === target)) setTarget("");
  }, [activities, target]);

  // Preview how many visitors with an active plan the reviewed update reaches (aggregate count only).
  useEffect(() => {
    if (!review) return;
    let cancelled = false;
    setImpact({ state: "loading" });
    const { targetType, targetId, startsAt, endsAt } = review.update;
    adminFetch(`/api/v1/events/${encodeURIComponent(event.slug)}/updates/impact`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetType, targetId, startsAt, endsAt }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("impact unavailable");
        const visitors = Number((await response.json())?.data?.affectedVisitors);
        if (!cancelled) setImpact(Number.isFinite(visitors) ? { state: "ready", visitors } : { state: "unavailable" });
      })
      .catch(() => { if (!cancelled) setImpact({ state: "unavailable" }); });
    return () => { cancelled = true; };
  }, [review, event.slug]);

  function preview(formEvent: FormEvent) {
    formEvent.preventDefault();
    setStatus("");
    setError("");
    if (!available.some((activity) => activity.stableKey === target) || !reason.trim()) {
      setError("اختر النشاط واكتب سببًا واضحًا للزوار.");
      return;
    }
    const effective = Date.now() + Number(startsIn) * 60_000;
    setReview({
      key: crypto.randomUUID(),
      update: {
        updateType: type, targetType: "activity", targetId: target,
        startsAt: new Date(effective).toISOString(),
        endsAt: new Date(effective + Number(validFor) * 60_000).toISOString(),
        payload: { reason: reason.trim(), ...(type === "DELAY" ? { minutes: Number(minutes) } : {}) },
      },
    });
  }

  async function publish() {
    if (!review || publishing) return;
    setPublishing(true);
    setError("");
    try {
      const response = await adminFetch(`/api/v1/events/${encodeURIComponent(event.slug)}/updates`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": review.key },
        body: JSON.stringify(review.update),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message ?? "تعذر نشر التحديث. حاول مرة ثانية.");
      }
      setReview(null);
      setReason("");
      setStatus("نُشر التحديث. يظهر في سجل الفعالية، ويتحقق الزوار من أثره على مساراتهم.");
      onPublished();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر نشر التحديث.");
    } finally {
      setPublishing(false);
    }
  }

  return <section className="card activity-updates" aria-labelledby="activity-updates-title">
    <h2 id="activity-updates-title">حدّث برنامج الفعالية</h2>
    <p>{event.name} · {timezoneLabel(event.timezone)}</p>
    {review ? <div className="update-preview">
      <h3>راجع قبل النشر</h3>
      <dl>
        <div><dt>الفعالية</dt><dd>{event.name}</dd></div>
        <div><dt>التحديث</dt><dd>{type === "CLOSURE" ? "إغلاق" : `تأخير ${minutes} دقيقة`}</dd></div>
        <div><dt>النشاط</dt><dd>{activityLabel(available.find((activity) => activity.stableKey === target))}</dd></div>
        <div><dt>السبب الظاهر للزوار</dt><dd>{review.update.payload.reason}</dd></div>
        <div><dt>يبدأ</dt><dd>{eventTime(review.update.startsAt, event.timezone)}</dd></div>
        <div><dt>ينتهي</dt><dd>{eventTime(review.update.endsAt, event.timezone)}</dd></div>
        <div><dt>الأثر المتوقع</dt><dd role="status" aria-live="polite" aria-busy={impact.state === "loading"}>{impactText(impact, review.update.updateType === "CLOSURE")}</dd></div>
      </dl>
      <div className="row">
        <button type="button" className="btn primary" disabled={publishing} onClick={publish}>{publishing ? "جارٍ النشر…" : "انشر التحديث"}</button>
        <button type="button" className="btn ghost" disabled={publishing} onClick={() => { setReview(null); setError(""); }}>تعديل</button>
      </div>
    </div> : <form onSubmit={preview}>
      <div className="activity-update-fields">
        <label htmlFor="activity-update-type">التحديث<select id="activity-update-type" value={type} onChange={(e) => setType(e.target.value === "CLOSURE" ? "CLOSURE" : "DELAY")}><option value="DELAY">تأخير نشاط</option><option value="CLOSURE">إغلاق نشاط</option></select></label>
        <label htmlFor="activity-update-activity">النشاط<select id="activity-update-activity" value={target} onChange={(e) => setTarget(e.target.value)} required disabled={!catalogReady}>
          <option value="">اختر نشاطًا من الكتالوج المنشور</option>
          {groupByZone(available).map((group) => <optgroup key={group.key || "none"} label={group.label}>
            {group.items.map((activity) => <option key={activity.stableKey} value={activity.stableKey}>{activityLabel(activity)}</option>)}
          </optgroup>)}
        </select></label>
        {type === "DELAY" && <label htmlFor="activity-update-minutes">دقائق التأخير<input id="activity-update-minutes" type="number" min={1} max={240} required value={minutes} onChange={(e) => setMinutes(e.target.value)} /></label>}
        <label htmlFor="activity-update-start">يبدأ بعد (دقائق)<input id="activity-update-start" type="number" min={0} max={1440} required value={startsIn} onChange={(e) => setStartsIn(e.target.value)} /></label>
        <label htmlFor="activity-update-duration">مدة سريان التحديث (دقائق)<input id="activity-update-duration" type="number" min={1} max={1440} required value={validFor} onChange={(e) => setValidFor(e.target.value)} /></label>
      </div>
      <label className="update-reason-field" htmlFor="activity-update-reason">السبب الظاهر للزوار<textarea id="activity-update-reason" required maxLength={200} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: تأخّر بدء النشاط" /></label>
      {!catalogReady && <p role="status">تظهر الأنشطة بعد تحميل الكتالوج المنشور.</p>}
      <button type="submit" className="btn primary" disabled={!catalogReady}>راجع التحديث</button>
    </form>}
    {error && <p className="err" role="alert">{error}</p>}
    {status && <p className="ok" role="status">{status}</p>}
  </section>;
}
