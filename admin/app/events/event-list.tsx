"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Topbar } from "../dashboard";
import { arCount, COUNT, eventStatusLabel } from "@/lib/arabic-labels";

const SLUG_PATTERN = "[a-z0-9]+(-[a-z0-9]+)*";

type EventRow = {
  id: string;
  slug: string;
  name: string;
  status: string;
  startsAt: string;
  endsAt: string;
  venue: { name: string; timezone: string } | null;
  publishedCatalogVersion: { versionNumber: number; status: string; zones: { id: string; name: string }[] } | null;
  counts: { visitorSessions: number; analyticsEvents: number; updates: number };
};

export default function EventList() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [organization, setOrganization] = useState<string>("");
  const [state, setState] = useState<"loading" | "ready" | "offline">("loading");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const visitorBase = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3100";
  const [form, setForm] = useState({ name: "", slug: "", startsAt: "2026-12-01T16:00", endsAt: "2026-12-05T23:00", venueName: "" });
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/v1/events")
      .then(async (response) => {
        if (!response.ok) throw new Error("events unavailable");
        return response.json();
      })
      .then((payload) => {
        setEvents(payload.data?.events ?? []);
        setOrganization(payload.data?.organization?.name ?? "");
        setState("ready");
      })
      .catch(() => setState("offline"));
  }, []);

  const createEvent = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (creating) return;
    if (form.startsAt && form.endsAt && form.endsAt <= form.startsAt) {
      setMessage("تاريخ النهاية يجب أن يكون بعد تاريخ البداية.");
      return;
    }
    setCreating(true);
    setMessage("");
    try {
      const response = await fetch("/api/v1/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage(payload.error?.message ?? "تعذر إنشاء الفعالية"); return; }
      setMessage("تم إنشاء الفعالية والمسودة الأولى للكتالوج.");
      setShowCreate(false);
      setForm({ name: "", slug: "", startsAt: "2026-12-01T16:00", endsAt: "2026-12-05T23:00", venueName: "" });
      const refresh = await fetch("/api/v1/events");
      if (!refresh.ok) throw new Error("events unavailable");
      setEvents((await refresh.json()).data?.events ?? []);
    } catch {
      setMessage("تعذر تحديث القائمة. تحقق منها قبل إعادة إرسال طلب الإنشاء.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="wrap">
      <Topbar current="events" />
      <main id="main-content" className="main-content" tabIndex={-1}>
      <div className="card" aria-busy={state === "loading"}>
        <header className="workspace-heading">
          <div>
            <h1>مساحات الفعاليات</h1>
            <p style={{ color: "var(--dim)", fontSize: 13 }}>{organization || "كتالوجات PostgreSQL المنشورة"}</p>
          </div>
          <div className="row"><span className={`badge${state === "ready" ? " on" : ""}`} role="status" aria-live="polite">{state === "ready" ? "متصل" : state === "loading" ? "جارٍ التحميل" : "غير متاح"}</span><button type="button" className="btn primary" disabled={state !== "ready" || creating} aria-expanded={showCreate} aria-controls="create-event-form" onClick={() => setShowCreate((value) => !value)}>فعالية جديدة</button></div>
        </header>
        {message && <div className={message.startsWith("تم") ? "ok" : "err"} role={message.startsWith("تم") ? "status" : "alert"} aria-live="polite">{message}</div>}
        {showCreate && <form id="create-event-form" className="card editor-form" aria-busy={creating} onSubmit={createEvent}>
          <h2>إنشاء فعالية قابلة للتهيئة</h2>
          <div className="grid2">
            <div><label htmlFor="event-name">اسم الفعالية</label><input id="event-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="مثال: مهرجان الشتاء" /></div>
            <div><label htmlFor="event-slug">المعرف العام بالإنجليزية</label><input id="event-slug" required dir="ltr" pattern={SLUG_PATTERN} aria-describedby="event-slug-hint" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="winter-festival" /><small id="event-slug-hint" style={{ color: "var(--dim)" }}>حروف إنجليزية صغيرة وأرقام وشرطات فقط، ويظهر في رابط الزائر.</small></div>
            <div><label htmlFor="event-starts-at">تبدأ</label><input id="event-starts-at" type="datetime-local" required value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></div>
            <div><label htmlFor="event-ends-at">تنتهي</label><input id="event-ends-at" type="datetime-local" required min={form.startsAt || undefined} value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} /></div>
            <div><label htmlFor="event-venue-name">الموقع (اختياري)</label><input id="event-venue-name" value={form.venueName} onChange={(e) => setForm({ ...form, venueName: e.target.value })} placeholder="اسم الموقع" /></div>
          </div>
          <div className="row editor-actions"><button type="submit" className="btn primary" disabled={creating}>{creating ? "جارٍ الإنشاء…" : "إنشاء"}</button><button type="button" className="btn ghost" disabled={creating} onClick={() => setShowCreate(false)}>إلغاء</button></div>
        </form>}
        {state === "offline" && <div className="err">تعذر قراءة الفعاليات الدائمة. تأكد من تشغيل PostgreSQL وتسجيل الدخول.</div>}
        {state === "ready" && (
          <div className="event-grid">
            {events.map((event) => (
              <article className="event-tile" key={event.id}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <h3>{event.name}</h3>
                  <span className={`badge${event.status === "LIVE" || event.status === "PUBLISHED" ? " on" : ""}`}>{eventStatusLabel(event.status)}</span>
                </div>
                <span className="mono"><bdi>{event.slug}</bdi></span>
                <span>{event.venue?.name ?? "بدون موقع"} · {event.publishedCatalogVersion ? `كتالوج v${event.publishedCatalogVersion.versionNumber}` : "لا يوجد كتالوج منشور"}</span>
                <small>{arCount(event.publishedCatalogVersion?.zones.length ?? 0, COUNT.zones)} · {arCount(event.counts.visitorSessions, COUNT.sessions)} · {arCount(event.counts.updates, COUNT.updates)}</small>
                <div className="row" style={{ marginTop: 8 }}>
                  <a className="btn small" href={`/events/${encodeURIComponent(event.slug)}`}>فتح مساحة الإدارة</a>
                  <a className="btn small ghost" href={`${visitorBase}/events/${encodeURIComponent(event.slug)}`} target="_blank" rel="noreferrer">واجهة الزائر ↗</a>
                </div>
              </article>
            ))}
            {!events.length && <p style={{ color: "var(--dim)" }}>لا توجد فعاليات في المنظمة الحالية.</p>}
          </div>
        )}
      </div>
      </main>
    </div>
  );
}
