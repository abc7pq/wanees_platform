"use client";
import { useEffect, useRef, useState } from "react";
import { ActivityUpdates, eventTime, type UpdateActivity } from "./activity-updates";
import { EventIncentives } from "./event-incentives";
import { CrowdOperations, type OperationsZone } from "./crowd-operations";
import { EventQr } from "./event-qr";
import { arCount, COUNT, eventStatusLabel } from "../lib/arabic-labels";
import { adminFetch } from "../lib/admin-fetch";
import { BrandLogo } from "./brand";
import { AnalyticsBreakdownsView, type AnalyticsBreakdowns } from "./analytics-breakdowns";
import { AccountNavLinks } from "./account-nav";

type DurableEvent = {
  id: string;
  slug: string;
  name: string;
  status: string;
  venue: { name: string; timezone: string } | null;
  publishedCatalogVersion: { versionNumber: number; status: string; zones: OperationsZone[] } | null;
};

type Analytics = {
  totals: { sessions: number; itineraries: number; updates: number; analyticsEvents: number; assistantEvents: number; openHandoffs: number; registeredVisitors?: number; returningVisitors?: number };
  metrics: { metricName: string; count: number; value: number }[];
  assistant: { intent: string; count: number; avgLatencyMs: number; sourceCount: number }[];
  breakdowns?: AnalyticsBreakdowns;
};

const RATING_COUNT = { zero: "لا تقييمات بعد", one: "تقييم واحد", two: "تقييمان", few: "{n} تقييمات", many: "{n} تقييمًا", other: "{n} تقييم" };
const REQUEST_COUNT = { zero: "لا طلبات", one: "طلب واحد", two: "طلبان", few: "{n} طلبات", many: "{n} طلبًا", other: "{n} طلب" };

/** Arabic names for the visitor assistant's intents (the API keeps the stable English keys). */
const ASSISTANT_INTENT_LABELS: Record<string, string> = {
  build: "بناء مسار", add: "إضافة نشاط", remove: "حذف محطة", swap: "تبديل محطة", shorten: "تقصير الجولة",
  search: "بحث وترشيح", location: "أماكن واتجاهات", status: "حالة المسار", crowd: "الزحام",
  explain: "شرح الاختيار", help: "طلب مساعدة", chat: "سوالف", faq: "أسئلة الفعالية", unknown: "غير واضح",
};

type Handoff = { id: string; category: string; redactedMessage: string | null; status: string; createdAt: string; resolvedAt: string | null };

const NEW_REQUEST_COUNT = { zero: "لا طلبات جديدة", one: "طلب مساعدة جديد", two: "طلبا مساعدة جديدان", few: "{n} طلبات مساعدة جديدة", many: "{n} طلب مساعدة جديدًا", other: "{n} طلب مساعدة جديد" };

/** Lost-child reports (the visitor assistant files them as generic help requests) go first. */
function isUrgentHandoff(handoff: Handoff) {
  return /lost|child/i.test(handoff.category)
    || /ضاع|ضايع|ضيعت|مفقود|lost (?:child|my kid)/i.test(handoff.redactedMessage ?? "");
}

function sortHandoffs(rows: Handoff[]) {
  return [...rows].sort((a, b) => {
    const urgency = Number(isUrgentHandoff(b) && b.status !== "RESOLVED") - Number(isUrgentHandoff(a) && a.status !== "RESOLVED");
    return urgency || b.createdAt.localeCompare(a.createdAt);
  });
}
type EventUpdate = {
  id: string; updateType: string; targetType: string; targetId: string | null;
  payload: Record<string, unknown>; startsAt: string | null; endsAt: string | null;
  createdAt: string; status: "ACTIVE" | "SCHEDULED" | "EXPIRED" | "REVOKED";
  revokedAt: string | null; revokedBy: { id: string; displayName: string } | null; revocationReason: string | null;
};

const updateTypeLabels: Record<string, string> = {
  CLOSURE: "إغلاق", DELAY: "تأخير", SCHEDULE_CHANGE: "تغيير موعد",
  CROWD_OVERRIDE: "تحديث زحام", CONTENT_CORRECTION: "تصحيح معلومة",
};
const updateStatusLabels: Record<string, string> = {
  ACTIVE: "نشط", SCHEDULED: "مجدول", EXPIRED: "منتهي", REVOKED: "مسحوب",
};

export default function Dashboard({ initialEvent = "" }: { initialEvent?: string }) {
  const [durableEvents, setDurableEvents] = useState<DurableEvent[]>([]);
  const [durableState, setDurableState] = useState<"loading" | "ready" | "offline">("loading");
  const [durableEventSlug, setDurableEventSlug] = useState(initialEvent);
  const [activities, setActivities] = useState<UpdateActivity[]>([]);
  const [updateRefresh, setUpdateRefresh] = useState(0);
  const [handoffFilter, setHandoffFilter] = useState<"OPEN" | "IN_PROGRESS" | "RESOLVED">("OPEN");
  const [handoffMessage, setHandoffMessage] = useState("");
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [analyticsState, setAnalyticsState] = useState<"loading" | "ready" | "offline">("loading");
  const [handoffs, setHandoffs] = useState<Handoff[]>([]);
  const [handoffState, setHandoffState] = useState<"loading" | "ready" | "offline">("loading");
  const [openHandoffCount, setOpenHandoffCount] = useState(0);
  const [handoffAnnouncement, setHandoffAnnouncement] = useState("");
  const seenOpenHandoffs = useRef<Set<string> | null>(null);
  const baseTitle = useRef<string | null>(null);
  const [eventUpdates, setEventUpdates] = useState<EventUpdate[]>([]);
  const [updatesView, setUpdatesView] = useState<"active" | "history">("active");
  const [updatesState, setUpdatesState] = useState<"loading" | "ready" | "offline">("loading");
  const [updatesError, setUpdatesError] = useState("");
  const [revokeTarget, setRevokeTarget] = useState<EventUpdate | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeMessage, setRevokeMessage] = useState("");
  const revokeDialogRef = useRef<HTMLElement | null>(null);
  const revokeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const revokeBusyRef = useRef(false);
  revokeBusyRef.current = revokeBusy;

  useEffect(() => {
    if (!revokeTarget) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = revokeDialogRef.current;
    const initialFocus = dialog?.querySelector<HTMLElement>("[data-dialog-initial-focus]");
    initialFocus?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!revokeBusyRef.current) setRevokeTarget(null);
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getAttribute("aria-hidden") !== "true");
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      requestAnimationFrame(() => {
        if (revokeTriggerRef.current?.isConnected) revokeTriggerRef.current.focus();
        else previous?.focus();
      });
    };
  }, [revokeTarget]);

  const load = () => {
    adminFetch("/api/v1/events")
      .then(async (r) => {
        if (!r.ok) throw new Error("durable api unavailable");
        return r.json();
      })
      .then((payload) => {
        const events = payload.data?.events ?? [];
        setDurableEvents(events);
        setDurableEventSlug((current) => events.some((event: DurableEvent) => event.slug === current) ? current : (events.find((event: DurableEvent) => event.status === "LIVE") ?? events[0])?.slug ?? "");
        setDurableState("ready");
      })
      .catch(() => setDurableState("offline"));
  };
  useEffect(() => { load(); const iv = setInterval(load, 5000); return () => clearInterval(iv); }, []);
  const selectedDurableEvent = durableEvents.find((event) => event.slug === durableEventSlug);
  const timezone = selectedDurableEvent?.venue?.timezone ?? "Asia/Riyadh";
  const eventZones = selectedDurableEvent?.publishedCatalogVersion?.zones ?? [];
  const metrics = new Map(analytics?.metrics.map((metric) => [metric.metricName, metric]));
  useEffect(() => {
    if (durableState !== "ready" || !durableEventSlug) return;
    const controller = new AbortController();
    const options = { signal: controller.signal };
    setActivities([]);
    setAnalyticsState("loading");
    async function refreshAnalytics() {
      try {
        const response = await adminFetch(`/api/v1/events/${durableEventSlug}/analytics`, options);
        if (!response.ok) throw new Error();
        const payload = await response.json();
        if (controller.signal.aborted) return;
        setAnalytics(payload.data ?? null);
        setAnalyticsState("ready");
      } catch {
        if (!controller.signal.aborted) setAnalyticsState("offline");
      }
    }
    void refreshAnalytics();
    const analyticsTimer = setInterval(refreshAnalytics, 15_000);
    void adminFetch(`/api/v1/events/${durableEventSlug}/catalog`, options)
      .then(async (response) => { if (!response.ok) throw new Error(); return response.json(); })
      .then((payload) => setActivities(payload.data?.selectedVersion?.status === "PUBLISHED" ? payload.data.selectedVersion.activities ?? [] : []))
      .catch(() => {});
    return () => { controller.abort(); clearInterval(analyticsTimer); };
  }, [durableEventSlug, durableState]);

  // A new event starts a fresh "seen" set so its existing requests are not announced as new.
  useEffect(() => { seenOpenHandoffs.current = null; setOpenHandoffCount(0); setHandoffAnnouncement(""); }, [durableEventSlug]);

  useEffect(() => {
    if (durableState !== "ready" || !durableEventSlug) return;
    const controller = new AbortController();
    const loadStatus = async (status: string) => {
      const response = await adminFetch(`/api/v1/events/${durableEventSlug}/handoffs?status=${status}`, { signal: controller.signal });
      if (!response.ok) throw new Error();
      const payload = await response.json();
      return (payload.data ?? []) as Handoff[];
    };
    const refresh = async () => {
      try {
        // The open queue is always polled so the tab badge, title and announcements stay current on every tab.
        const open = await loadStatus("OPEN");
        const rows = handoffFilter === "OPEN" ? open : await loadStatus(handoffFilter);
        if (controller.signal.aborted) return;
        const seen = seenOpenHandoffs.current;
        const fresh = seen ? open.filter((handoff) => !seen.has(handoff.id)) : [];
        seenOpenHandoffs.current = new Set([...(seen ?? []), ...open.map((handoff) => handoff.id)]);
        if (fresh.length) {
          const urgent = fresh.some(isUrgentHandoff);
          setHandoffAnnouncement(`${urgent ? "عاجل: بلاغ طفل مفقود. " : ""}وصل ${arCount(fresh.length, NEW_REQUEST_COUNT)}.`);
        }
        setOpenHandoffCount(open.length);
        setHandoffs(sortHandoffs(rows));
        setHandoffState("ready");
      } catch {
        if (!controller.signal.aborted) setHandoffState("offline");
      }
    };
    setHandoffState("loading");
    setHandoffMessage("");
    void refresh();
    const timer = setInterval(refresh, 10_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [durableEventSlug, durableState, handoffFilter]);

  useEffect(() => {
    if (baseTitle.current === null) baseTitle.current = document.title;
    const base = baseTitle.current;
    document.title = openHandoffCount ? `(${openHandoffCount}) ${base}` : base;
  }, [openHandoffCount]);
  useEffect(() => () => { if (baseTitle.current !== null) document.title = baseTitle.current; }, []);

  useEffect(() => {
    if (durableState !== "ready" || !durableEventSlug) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await adminFetch(`/api/v1/events/${encodeURIComponent(durableEventSlug)}/updates?view=${updatesView}`);
        if (!response.ok) throw new Error("تعذر تحميل التحديثات");
        const payload = await response.json();
        if (cancelled) return;
        setEventUpdates(payload.data ?? []);
        setUpdatesError("");
        setUpdatesState("ready");
      } catch {
        if (cancelled) return;
        setUpdatesError("تعذر تحميل التحديثات. تحقق من صلاحية المشغّل واتصال قاعدة البيانات.");
        setUpdatesState("offline");
      }
    };
    setUpdatesState("loading");
    void refresh();
    const interval = setInterval(refresh, 10_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [durableEventSlug, durableState, updatesView, updateRefresh]);

  const updateHandoff = async (handoffId: string, status: "IN_PROGRESS" | "RESOLVED") => {
    setHandoffMessage("");
    try {
      const response = await adminFetch(`/api/v1/events/${encodeURIComponent(durableEventSlug)}/handoffs`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handoffId, status }),
      });
      if (!response.ok) throw new Error();
      // Stay on the current tab so the operator can keep working through the queue.
      const previous = handoffs.find((handoff) => handoff.id === handoffId);
      setHandoffs((current) => current.filter((handoff) => handoff.id !== handoffId));
      if (previous?.status === "OPEN") setOpenHandoffCount((count) => Math.max(0, count - 1));
    } catch {
      setHandoffMessage("تعذر تحديث حالة الطلب. حاول مرة ثانية.");
    }
  };

  const revokeUpdate = async () => {
    if (!revokeTarget || !durableEventSlug || revokeBusy) return;
    setRevokeBusy(true);
    setRevokeMessage("");
    try {
      const response = await adminFetch(`/api/v1/events/${encodeURIComponent(durableEventSlug)}/updates/${encodeURIComponent(revokeTarget.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke", ...(revokeReason.trim() ? { reason: revokeReason.trim() } : {}) }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "تعذر سحب التحديث");
      setRevokeTarget(null);
      setRevokeReason("");
      setRevokeMessage("تم سحب التحديث وحفظ الإجراء في سجل التدقيق.");
      setUpdatesView("history");
    } catch (error) {
      setRevokeMessage(error instanceof Error ? error.message : "تعذر سحب التحديث");
    } finally {
      setRevokeBusy(false);
    }
  };

  const targetLabel = (update: EventUpdate) => {
    if (update.targetType === "event") return "الفعالية كاملة";
    if (update.targetType === "zone") return eventZones.find((item) => item.id === update.targetId)?.name ?? update.targetId ?? "منطقة";
    return activities.find((item) => item.stableKey === update.targetId)?.nameAr ?? update.targetId ?? "نشاط";
  };

  return (
    <div className="wrap">
      <Topbar current="dashboard" />
      <main id="main-content" className="main-content" tabIndex={-1}>
      <header className="workspace-heading workspace-banner">
        <div><h1>لوحة إدارة ونيس</h1><p>تابع الفعاليات الحية وطلبات مساعدة الزوار.</p></div>
        <a className="btn" href="/events">مساحات الفعاليات</a>
      </header>
      <nav className="workspace-links" aria-label="أقسام لوحة الإدارة">
        <a href="#operations">التشغيل</a>
        <a href="#live-updates-heading">التحديثات</a>
        <a href="#handoffs">طلبات المساعدة</a>
        <a href="#analytics">المؤشرات</a>
      </nav>
      <section className="card" aria-labelledby="operation-event-title">
        <h2 id="operation-event-title">الفعالية قيد المتابعة</h2>
        {durableState === "ready" && durableEvents.length > 0 && <>
          <label htmlFor="dashboard-event">اختر الفعالية</label>
          <select id="dashboard-event" value={durableEventSlug} onChange={(event) => setDurableEventSlug(event.target.value)}>
            {durableEvents.map((event) => <option key={event.id} value={event.slug}>{event.name}</option>)}
          </select>
          {selectedDurableEvent?.publishedCatalogVersion && ["PUBLISHED", "LIVE"].includes(selectedDurableEvent.status)
            ? <EventQr key={selectedDurableEvent.slug} slug={selectedDurableEvent.slug} />
            : <p>يظهر رابط الزائر بعد نشر الفعالية وكتالوجها.</p>}
        </>}
        {durableState === "ready" && durableEvents.length === 0 && <p>لا توجد فعاليات في هذه المساحة.</p>}
        {durableState !== "ready" && <p role="status">{durableState === "loading" ? "جارٍ تحميل الفعاليات…" : "تعذر تحميل الفعاليات."}</p>}
      </section>

      <div className="activity-updates-slot">
        {selectedDurableEvent && <ActivityUpdates
          key={selectedDurableEvent.slug}
          event={{ slug: selectedDurableEvent.slug, name: selectedDurableEvent.name, timezone }}
          activities={activities}
          onPublished={() => { setUpdatesView("active"); setUpdateRefresh((current) => current + 1); }}
        />}
      </div>
      <div className="card">
        <h2 id="analytics">أثر المرشد — آخر 24 ساعة</h2>
        {analyticsState === "loading" && <p style={{ color: "var(--dim)" }}>جارٍ تجميع المؤشرات…</p>}
        {analyticsState === "offline" && <div className="err">القياس الدائم غير متاح في هذا التشغيل.</div>}
        {analyticsState === "ready" && analytics && <>
          <div className="analytics-grid">
            <div><strong>{analytics.totals.sessions}</strong><span>جلسات</span></div>
            <div><strong>{analytics.totals.itineraries}</strong><span>مسارات</span></div>
            <div><strong>{analytics.totals.updates}</strong><span>تحديثات حية</span></div>
            <div><strong>{analytics.totals.assistantEvents}</strong><span>تفاعلات المرشد</span></div>
            <div><strong>{analytics.totals.openHandoffs}</strong><span>طلبات مساعدة مفتوحة</span></div>
            {typeof analytics.totals.registeredVisitors === "number" && analytics.totals.registeredVisitors > 0 && <>
              <div><strong>{analytics.totals.registeredVisitors}</strong><span>زوار مسجّلون</span></div>
              <div><strong>{Math.round(((analytics.totals.returningVisitors ?? 0) / analytics.totals.registeredVisitors) * 100)}%</strong><span>زوار عائدون</span></div>
            </>}
          </div>
          <h3>تفاعل الزوار مع المسار</h3>
          <div className="analytics-grid">
            <div><strong>{metrics.get("replan_proposed")?.count ?? 0}</strong><span>بدائل عُرضت</span></div>
            <div><strong>{metrics.get("replan_applied")?.count ?? 0}</strong><span>تغييرات طُبقت</span></div>
            <div><strong>{metrics.get("replan_dismissed")?.count ?? 0}</strong><span>مرات الإبقاء على المسار</span></div>
            {(() => {
              // Anonymous 1–5 rating visitors give at the end of their plan.
              const rating = metrics.get("visit_rating");
              return <div>
                <strong>{rating?.count ? `${(rating.value / rating.count).toFixed(1)} / 5` : "—"}</strong>
                <span>رضا الزوار · {arCount(rating?.count ?? 0, RATING_COUNT)}</span>
              </div>;
            })()}
            {/* time_to_plan_seconds is measured in the browser from opening WANEES to a ready plan (questions included), not engine time. */}
            {([["time_to_plan_seconds", "متوسط الوقت من فتح ونيس حتى جاهزية المسار"], ["update_delivery_seconds", "متوسط الوقت من نشر التحديث إلى عرض البديل"]] as const)
              .map(([metricName, label]) => {
                const metric = metrics.get(metricName);
                return <div key={metricName}>
                  <strong>{metric?.count ? Math.round(metric.value / metric.count) + " ث" : "—"}</strong>
                  <span>{label} · {metric?.count ?? 0} قياس</span>
                </div>;
              })}
          </div>
          <div className="assistant-metrics">
            {analytics.assistant.slice(0, 5).map((item) => <span key={item.intent} title={item.intent}>{ASSISTANT_INTENT_LABELS[item.intent] ?? item.intent} · {arCount(item.count, REQUEST_COUNT)} · {(item.avgLatencyMs / 1000).toFixed(1)} ث</span>)}
            {!analytics.assistant.length && <small>لا توجد تفاعلات مرشد بعد.</small>}
          </div>
          <AnalyticsBreakdownsView breakdowns={analytics.breakdowns} />
        </>}
      </div>

      <div className="card">
        <h2 id="handoffs">طلبات مساعدة الزوار</h2>
        <div className="updates-tabs" role="group" aria-label="حالة طلبات المساعدة">
          {([["OPEN", "جديدة"], ["IN_PROGRESS", "قيد المتابعة"], ["RESOLVED", "تم حلها"]] as const).map(([value, name]) =>
            <button type="button" key={value} aria-pressed={handoffFilter === value} onClick={() => setHandoffFilter(value)}>
              {name}{value === "OPEN" && openHandoffCount > 0 && <span className="badge on handoff-count" aria-label={arCount(openHandoffCount, REQUEST_COUNT)}>{openHandoffCount}</span>}
            </button>
          )}
        </div>
        <p className="sr-only" aria-live="polite" role="status">{handoffAnnouncement}</p>
        {handoffMessage && <p className="err" role="alert">{handoffMessage}</p>}
        {handoffState === "loading" && <p style={{ color: "var(--dim)" }}>جارٍ تحميل الطلبات…</p>}
        {handoffState === "offline" && <div className="err">تعذر تحميل طلبات المساعدة.</div>}
        {handoffState === "ready" && !handoffs.length && <p style={{ color: "var(--dim)" }}>لا توجد طلبات في هذه الحالة.</p>}
        {handoffState === "ready" && handoffs.map((handoff) => {
          const urgent = handoff.status !== "RESOLVED" && isUrgentHandoff(handoff);
          return (
          <div key={handoff.id} className={`handoff-row${urgent ? " urgent" : ""}`}>
            <div>
              {urgent && <span className="badge urgent-badge">عاجل — طفل مفقود</span>}
              <strong>{handoff.redactedMessage || "طلب مساعدة من زائر"}</strong>
              <small style={{ display: "block", color: "var(--dim)", marginTop: 4 }}>{eventTime(handoff.createdAt, timezone)}</small>
            </div>
            <div className="row">
              {handoff.status === "OPEN" && <button type="button" className="btn" onClick={() => updateHandoff(handoff.id, "IN_PROGRESS")}>استلام</button>}
              {handoff.status !== "RESOLVED" && <button type="button" className="btn primary" onClick={() => updateHandoff(handoff.id, "RESOLVED")}>تم الحل</button>}
            </div>
          </div>
          );
        })}
      </div>

      <div className="card">
        <h2>كتالوجات الفعاليات</h2>
        {durableState === "loading" && <p style={{ color: "var(--dim)" }}>جارٍ فحص الكتالوج المنشور…</p>}
        {durableState === "offline" && <div className="err">قاعدة البيانات غير متاحة في هذا التشغيل؛ ما يظهر في الديمو القديم قد يكون من الذاكرة أو JSON.</div>}
        {durableState === "ready" && (
          <div className="event-grid">
            {durableEvents.map((event) => (
              <div className="event-tile" key={event.id}>
                <strong>{event.name}</strong>
                <span>{event.venue?.name ?? "بدون موقع"} · {eventStatusLabel(event.status)}</span>
                <span>{event.publishedCatalogVersion ? `كتالوج v${event.publishedCatalogVersion.versionNumber}` : "لا يوجد كتالوج منشور"}</span>
              </div>
            ))}
            {!durableEvents.length && <p style={{ color: "var(--dim)" }}>لا توجد فعاليات منشورة.</p>}
          </div>
        )}
      </div>

      <div id="operations">
      {selectedDurableEvent && <CrowdOperations key={durableEventSlug}
        eventSlug={durableEventSlug} timezone={timezone} zones={eventZones}
        updates={updatesView === "active" && updatesState === "ready" ? eventUpdates : []}
        onPublished={() => { setUpdatesView("active"); setUpdateRefresh((current) => current + 1); }}
      />}
      </div>

      {selectedDurableEvent && <EventIncentives key={durableEventSlug} eventSlug={durableEventSlug} timezone={timezone} zones={eventZones} />}
      <section className="card" aria-labelledby="live-updates-heading">
        <div className="updates-heading">
          <div>
            <h2 id="live-updates-heading">التحديثات التشغيلية</h2>
            <p>راجع تحديثات الفعالية واسحب التحديث غير الصحيح. التغييرات محفوظة في سجل التدقيق.</p>
          </div>
          <div className="updates-tabs" role="group" aria-label="عرض التحديثات">
            <button type="button" aria-pressed={updatesView === "active"} className={updatesView === "active" ? "selected" : ""} onClick={() => setUpdatesView("active")}>النشطة</button>
            <button type="button" aria-pressed={updatesView === "history"} className={updatesView === "history" ? "selected" : ""} onClick={() => setUpdatesView("history")}>السجل</button>
          </div>
        </div>
        {revokeMessage && <div className={revokeMessage.startsWith("تم سحب") ? "ok" : "err"} role="status">{revokeMessage}</div>}
        {updatesState === "loading" && <p className="updates-empty" aria-live="polite">جارٍ تحميل التحديثات…</p>}
        {updatesState === "offline" && <div className="err" role="alert">{updatesError}</div>}
        {updatesState === "ready" && eventUpdates.length === 0 && <p className="updates-empty">{updatesView === "active" ? "لا توجد تحديثات نشطة لهذه الفعالية." : "لا يوجد سجل تحديثات بعد."}</p>}
        {updatesState === "ready" && eventUpdates.length > 0 && <div className="updates-list">
          {eventUpdates.map((update) => (
            <article className="update-row" key={update.id}>
              <div className="update-main">
                <div className="update-title">
                  <strong>{updateTypeLabels[update.updateType] ?? update.updateType}</strong>
                  <span className={`badge ${update.status === "ACTIVE" ? "on" : ""}`}>{updateStatusLabels[update.status] ?? update.status}</span>
                </div>
                <div className="update-meta">
                  <span>{targetLabel(update)}</span>
                  <span>أُضيف {eventTime(update.createdAt, timezone)}</span>
                  {update.startsAt && <span>يبدأ {eventTime(update.startsAt, timezone)}</span>}
                  {typeof update.payload.minutes === "number" && <span>تأخير {arCount(update.payload.minutes, COUNT.minutes)}</span>}
                  {update.endsAt && <span>ينتهي {eventTime(update.endsAt, timezone)}</span>}
                  {update.revokedAt && <span>سُحب {eventTime(update.revokedAt, timezone)}{update.revokedBy ? ` بواسطة ${update.revokedBy.displayName}` : ""}</span>}
                  {typeof update.payload.level === "number" && <span>مستوى الزحام {Math.round(update.payload.level * 100)}%</span>}
                </div>
                {typeof update.payload.reason === "string" && <p className="update-reason">{update.payload.reason}</p>}
              {update.revocationReason && <p className="update-reason">سبب السحب: {update.revocationReason}</p>}
              </div>
              {updatesView === "active" && <button type="button" className="btn danger" onClick={(event) => { revokeTriggerRef.current = event.currentTarget; setRevokeTarget(update); setRevokeReason(""); setRevokeMessage(""); }}>سحب التحديث</button>}
            </article>
          ))}
        </div>}
      </section>

      {revokeTarget && <div className="updates-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !revokeBusy) setRevokeTarget(null); }}>
        <section ref={revokeDialogRef} className="updates-dialog" role="dialog" aria-modal="true" aria-labelledby="revoke-dialog-title" aria-describedby="revoke-dialog-description" tabIndex={-1}>
          <h2 id="revoke-dialog-title">تأكيد سحب التحديث</h2>
          <p id="revoke-dialog-description">سيُسحب تحديث «{updateTypeLabels[revokeTarget.updateType] ?? revokeTarget.updateType}» عن {targetLabel(revokeTarget)}، ولن يُحذف من السجل.</p>
          <label htmlFor="revoke-reason">سبب السحب <span>(اختياري)</span></label>
          <textarea id="revoke-reason" data-dialog-initial-focus maxLength={500} rows={3} value={revokeReason} onChange={(event) => setRevokeReason(event.target.value)} placeholder="مثال: أُدخلت المنطقة بالخطأ" />
          <small>{revokeReason.length}/500</small>
          <div className="row updates-dialog-actions">
            <button type="button" className="btn ghost" disabled={revokeBusy} onClick={() => setRevokeTarget(null)}>إلغاء</button>
            <button type="button" className="btn danger" disabled={revokeBusy} onClick={revokeUpdate}>{revokeBusy ? "جارٍ السحب…" : "تأكيد السحب"}</button>
          </div>
        </section>
      </div>}

      </main>
    </div>
  );
}

export function Topbar({ current = "dashboard" }: { current?: "dashboard" | "events" | "visitors" | "users" | "audit" }) {
  return (
    <>
      <a className="skip-link" href="#main-content">تخطى إلى المحتوى الرئيسي</a>
      <header className="topbar">
      <a className="brand" href="/" aria-label="ونيس، لوحة الإدارة"><BrandLogo height={34} label="" priority /><span className="brand-section">الإدارة</span></a>
      <nav className="admin-nav" aria-label="التنقل الرئيسي">
        <a className={`navlink${current === "dashboard" ? " active" : ""}`} href="/" aria-current={current === "dashboard" ? "page" : undefined}>اللوحة</a>
        <a className={`navlink${current === "events" ? " active" : ""}`} href="/events" aria-current={current === "events" ? "page" : undefined}>مساحات الفعاليات</a>
        <a className={`navlink${current === "visitors" ? " active" : ""}`} href="/visitors" aria-current={current === "visitors" ? "page" : undefined}>الزوار</a>
        <AccountNavLinks current={current} />
        <a className="navlink" href={process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3100"} target="_blank" rel="noreferrer">واجهة الزائر ↗</a>
        <LogoutBtn />
      </nav>
      </header>
    </>
  );
}

export function LogoutBtn() {
  return (
    <button type="button" className="navlink" aria-label="تسجيل الخروج" style={{ background: "none", border: "none", cursor: "pointer", font: "inherit" }}
      onClick={async () => { try { await fetch("/api/logout", { method: "POST" }); } catch {} location.href = "/login"; }}>
      خروج
    </button>
  );
}
