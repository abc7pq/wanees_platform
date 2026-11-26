"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Topbar } from "../../dashboard";
import { WalkingSegments, type WalkingSegment } from "./walking-segments";
import { NavigationSettings } from "./navigation-settings";
import { adminFetch } from "@/lib/admin-fetch";
import { activityStatusLabel, arCount, COUNT, nodeStatusLabel, nodeTypeLabel, priceLabel, sourceLocatorLabel, sourceTypeLabel } from "@/lib/arabic-labels";

type Version = {
  id: string;
  versionNumber: number;
  status: string;
  sourceSummary: string | null;
  validationReport: { valid?: boolean; checkedAt?: string; errors?: { code: string; message: string; entity?: string }[]; warnings?: { code: string; message: string; entity?: string }[] } | null;
  crosswalkStatus?: "NOT_REQUIRED" | "HOLD" | "VERIFIED";
  crosswalkChecksum?: string | null;
  publishedAt: string | null;
  counts: { zones: number; activities: number; contentSources: number; routeNodes?: number; routeEdges?: number };
};

type Activity = {
  id: string;
  stableKey: string;
  nameAr: string;
  durationMin: number;
  priceMinCents: number | null;
  priceMaxCents: number | null;
  familyFriendly: boolean;
  ageMin: number | null;
  status: string;
  reviewStatus: string;
  sourceRefs: string[];
  zone: { stableKey: string; nameAr: string };
  descriptionAr?: string | null;
  tags?: string[];
  tagSuggestions?: string[];
  entranceNodeKey?: string | null;
};

type RouteNode = { id: string; stableKey: string; type: string; label: string; description?: string | null; aliases: string[]; x: number; y: number; accessible: boolean; status: string; zoneId?: string | null };

type Catalog = {
  event: { id: string; slug: string; name?: string; publishedCatalogVersionId: string | null };
  versions: Version[];
  selectedVersion: (Version & { config: unknown; zones: { id: string; stableKey: string; nameAr: string; nameEn?: string | null; capacity?: number | null }[]; activities: Activity[]; routeNodes: RouteNode[]; routeEdges: WalkingSegment[]; contentSources: { id: string; title: string; sourceType: string; locator?: string | null; observedAt?: string | null; checksum?: string | null; reviewStatus: string }[] }) | null;
};

function statusLabel(status: string) {
  return ({ DRAFT: "مسودة", VALIDATING: "قيد التحقق", PUBLISHED: "منشور", SUPERSEDED: "مستبدل", REJECTED: "مرفوض" } as Record<string, string>)[status] ?? status;
}

/** Schedule minutes after midnight ↔ "HH:MM" for time inputs; 1440 (midnight close) shows as 00:00. */
function minutesToClock(minutes: number) {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function clockToMinutes(value: string, isEnd: boolean) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return isEnd && minutes === 0 ? 1440 : minutes;
}

// Versions stored before the summaries were translated still carry English text.
function summaryLabel(summary: string | null) {
  if (!summary) return summary;
  const copied = summary.match(/^Draft copied from catalog v(\d+)$/);
  if (copied) return `مسودة منسوخة من الكتالوج v${copied[1]}`;
  return ({
    "Created from WANEES admin workspace": "أُنشئت من مساحة إدارة ونيس",
    "Seeded isolation fixture": "بيانات تجريبية لاختبار عزل الفعاليات",
    "Boulevard World demo fixture": "بيانات عرض بوليفارد وورلد",
  } as Record<string, string>)[summary] ?? summary;
}

export default function CatalogWorkspace({ eventSlug }: { eventSlug: string }) {
  const visitorBase = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3100";
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [versionId, setVersionId] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "offline">("loading");
  const [message, setMessage] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDuration, setEditDuration] = useState(30);
  const [editPrice, setEditPrice] = useState("");
  const [editMaxPrice, setEditMaxPrice] = useState("");
  const [editFamily, setEditFamily] = useState(false);
  const [editAge, setEditAge] = useState("");
  const [editSource, setEditSource] = useState("");
  const [editSchedule, setEditSchedule] = useState({ start: "", end: "" });
  // Audit 1.3: the description and controlled tags the matching uses; suggestions wait for approval.
  const [editDescription, setEditDescription] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editEntrance, setEditEntrance] = useState("");
  const [zoneForm, setZoneForm] = useState({ stableKey: "", nameAr: "", mapX: 0, mapY: 0 });
  const [capacityForm, setCapacityForm] = useState({ zoneKey: "", capacity: "", source: "" });
  const [activityForm, setActivityForm] = useState({ stableKey: "", nameAr: "", zoneStableKey: "", durationMin: 30, priceSar: "", scheduleFromMin: 1020, scheduleToMin: 1400, factsSource: "", familyFriendly: false });
  const [nodeForm, setNodeForm] = useState({ stableKey: "", label: "", type: "SERVICE", zoneStableKey: "", x: 0, y: 0, aliases: "", description: "", accessible: false });

  const basePath = `/api/v1/events/${encodeURIComponent(eventSlug)}/catalog`;
  const load = useCallback(async (requestedVersionId?: string) => {
    const query = requestedVersionId ? `?versionId=${encodeURIComponent(requestedVersionId)}` : "";
    const response = await adminFetch(`${basePath}${query}`);
    if (!response.ok) throw new Error("catalog unavailable");
    const payload = await response.json();
    setCatalog(payload.data);
    setVersionId(payload.data.selectedVersion?.id ?? "");
    setState("ready");
  }, [basePath]);

  useEffect(() => { load().catch(() => setState("offline")); }, [load]);
  // Forms belong to one version: switching versions must not show another version's values as if they were its own.
  useEffect(() => { setCapacityForm({ zoneKey: "", capacity: "", source: "" }); setEditing(null); }, [versionId]);

  const selected = catalog?.selectedVersion ?? null;
  const canEdit = selected?.status === "DRAFT" || selected?.status === "REJECTED";
  const validation = selected?.validationReport;
  const activityCount = selected?.activities.length ?? 0;
  const title = useMemo(() => catalog?.event.name || catalog?.event.slug || eventSlug, [catalog?.event.name, catalog?.event.slug, eventSlug]);

  const action = async (path: string, body: Record<string, unknown>, success: string, method = "POST") => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await adminFetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error?.message ?? "تعذر تنفيذ العملية");
      setMessage({ text: success, kind: "ok" });
      const reloadVersionId = typeof body.versionId === "string" ? body.versionId : (typeof payload.data?.id === "string" ? payload.data.id : undefined);
      await load(reloadVersionId);
      return true;
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "تعذر تنفيذ العملية", kind: "err" });
      return false;
    } finally { setBusy(false); }
  };

  const startEdit = (activity: Activity) => {
    setEditing(activity.stableKey);
    setEditName(activity.nameAr);
    setEditDuration(activity.durationMin);
    setEditPrice(activity.priceMinCents == null ? "" : String(activity.priceMinCents / 100));
    setEditMaxPrice(activity.priceMaxCents == null ? "" : String(activity.priceMaxCents / 100));
    setEditFamily(activity.familyFriendly);
    setEditAge(activity.ageMin == null ? "" : String(activity.ageMin));
    setEditSource("");
    setEditSchedule({ start: "", end: "" });
    setEditDescription(activity.descriptionAr ?? "");
    setEditTags((activity.tags ?? []).join("، "));
    setEditEntrance(activity.entranceNodeKey ?? "");
  };

  const saveEdit = async () => {
    if (!editing || !versionId) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await adminFetch(`${basePath}/items/${encodeURIComponent(editing)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          versionId, nameAr: editName, durationMin: editDuration, factsSource: editSource,
          priceMinCents: editPrice === "" ? null : Math.round(Number(editPrice) * 100),
          priceMaxCents: editMaxPrice === "" ? null : Math.round(Number(editMaxPrice) * 100),
          familyFriendly: editFamily, ageMin: editAge === "" ? null : Number(editAge),
          descriptionAr: editDescription,
          tags: editTags.split(/[،,]/).map((tag) => tag.trim()).filter(Boolean),
          entranceNodeKey: editEntrance || null,
          ...(editSchedule.start || editSchedule.end ? {
            scheduleStartsAt: editSchedule.start && editSchedule.start + "+03:00",
            scheduleEndsAt: editSchedule.end && editSchedule.end + "+03:00",
          } : {}),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error?.message ?? "تعذر حفظ النشاط");
      setMessage({ text: "تم حفظ النشاط في المسودة.", kind: "ok" });
      setEditing(null);
      await load(versionId);
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "تعذر حفظ النشاط", kind: "err" });
    } finally { setBusy(false); }
  };

  const createZone = async () => {
    if (!versionId || !zoneForm.nameAr.trim()) return;
    if (await action(`${basePath}/zones`, { versionId, ...zoneForm }, "تمت إضافة المنطقة إلى المسودة.")) {
      setZoneForm({ stableKey: "", nameAr: "", mapX: 0, mapY: 0 });
    }
  };

  const createActivity = async () => {
    if (!versionId || !activityForm.nameAr.trim() || !activityForm.zoneStableKey) return;
    if (activityForm.scheduleToMin <= activityForm.scheduleFromMin) {
      setMessage({ text: "تعذر الحفظ: وقت نهاية التشغيل يجب أن يكون بعد وقت البداية.", kind: "err" });
      return;
    }
    if (await action(`${basePath}/items`, { versionId, ...activityForm, priceSar: activityForm.priceSar === "" ? null : Number(activityForm.priceSar) }, "تمت إضافة النشاط إلى المسودة.")) {
      setActivityForm({ stableKey: "", nameAr: "", zoneStableKey: "", durationMin: 30, priceSar: "", scheduleFromMin: 1020, scheduleToMin: 1400, factsSource: "", familyFriendly: false });
    }
  };

  const createNode = async () => {
    if (!versionId || !nodeForm.label.trim()) return;
    if (await action(`${basePath}/nodes`, { versionId, ...nodeForm, aliases: nodeForm.aliases.split(",").map((item) => item.trim()).filter(Boolean) }, "تمت إضافة الموقع إلى المسودة.")) {
      setNodeForm({ stableKey: "", label: "", type: "SERVICE", zoneStableKey: "", x: 0, y: 0, aliases: "", description: "", accessible: false });
    }
  };

  const reviewSource = async (sourceId: string, reviewStatus: "VERIFIED" | "REJECTED") => {
    if (reviewStatus === "REJECTED" && !window.confirm("هل تريد رفض هذا المصدر؟ ستحتاج المسودة إلى مصدر معتمد قبل النشر.")) return;
    await action(`${basePath}/review`, { versionId, sourceId, reviewStatus }, reviewStatus === "VERIFIED" ? "تم اعتماد المصدر والعناصر المرتبطة به." : "تم رفض المصدر والعناصر المرتبطة به.");
  };

  return (
    <div className="wrap">
      <Topbar current="events" />
      <main id="main-content" className="main-content" tabIndex={-1}>
      <header className="workspace-heading workspace-banner">
        <div>
          <a className="navlink" href="/events">← كل الفعاليات</a>
          <h1>{title}</h1>
          <p>إدارة الكتالوج والنشر</p>
          <a className="btn ghost" href={`/?event=${encodeURIComponent(eventSlug)}`}>التحديثات التشغيلية</a>
        </div>
        <a className="btn primary" href={`${visitorBase}/events/${encodeURIComponent(eventSlug)}`} target="_blank" rel="noreferrer">فتح واجهة الزائر ↗</a>
      </header>

      {state === "loading" && <p className="card" role="status">جارٍ تحميل الكتالوج…</p>}
      {state === "offline" && <div className="card" role="alert"><p className="err">تعذر تحميل الكتالوج. تحقق من الفعالية أو حاول مرة أخرى.</p><button className="btn" type="button" onClick={() => location.reload()}>إعادة المحاولة</button></div>}
      {catalog && <>
        <nav className="workspace-links" aria-label="أقسام الكتالوج">
          <a href="#catalog-versions">الإصدارات</a>
          {selected && <>
            <a href="#catalog-sources">المصادر</a>
            <a href="#catalog-activities">الأنشطة</a>
            <a href="#catalog-locations">المواقع</a>
          </>}
          <a href="#navigation-settings">التوجيه وGPS</a>
        </nav>
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 id="catalog-versions">إصدارات الكتالوج</h2>
            <button className="btn" disabled={busy || !catalog.versions.length} onClick={() => action(basePath, { fromVersionId: catalog.event.publishedCatalogVersionId }, "أُنشئت مسودة جديدة.")}>نسخ مسودة</button>
          </div>
          <div className="event-grid">
            {catalog.versions.map((version) => (
              <div key={version.id} className="event-tile">
                <button type="button" className="version-tile" aria-pressed={version.id === selected?.id} disabled={busy} onClick={() => { void load(version.id).catch(() => setMessage({ text: "تعذر تحميل الإصدار.", kind: "err" })); }}>
                  <div className="row" style={{ justifyContent: "space-between" }}><strong>v{version.versionNumber}</strong><span className={`badge${version.status === "PUBLISHED" ? " on" : ""}`}>{statusLabel(version.status)}</span></div>
                  <span>{arCount(version.counts.zones, COUNT.zones)} · {arCount(version.counts.activities, COUNT.activities)} · {arCount(version.counts.routeNodes ?? 0, COUNT.locations)} · {arCount(version.counts.contentSources, COUNT.sources)}</span>
                  <small>{summaryLabel(version.sourceSummary) ?? "بدون وصف مصدر"}</small>
                </button>
                {version.status === "SUPERSEDED" && <button type="button" className="btn small ghost" disabled={busy} onClick={() => { if (window.confirm(`استعادة v${version.versionNumber} تنشرها فورًا للزوار الجدد بدل النسخة الحالية. متابعة؟`)) void action(`${basePath}/rollback`, { versionId: version.id, crosswalkChecksum: version.crosswalkChecksum ?? undefined }, `تمت استعادة v${version.versionNumber}.`); }}>استعادة هذه النسخة</button>}
              </div>
            ))}
          </div>
        </div>

        {selected && <>
          <div className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div><h2>v{selected.versionNumber} · {statusLabel(selected.status)}</h2><p style={{ color: "var(--dim)", fontSize: 13 }}>{arCount(selected.zones.length, COUNT.zones)} · {arCount(activityCount, COUNT.activities)} · {arCount(selected.routeNodes.length, COUNT.locations)} · {arCount(selected.routeEdges.length, COUNT.paths)}</p></div>
              <div className="row">
                {(selected.status === "DRAFT" || selected.status === "REJECTED") && <button className="btn" disabled={busy} onClick={() => action(`${basePath}/validate`, { versionId }, "تم التحقق من المسودة.")}>تحقق</button>}
                {selected.status === "DRAFT" && validation?.valid && <button className="btn primary" disabled={busy} onClick={() => { if (window.confirm(`نشر v${selected.versionNumber} يجعلها نسخة الزوار الجدد فورًا. الزيارات الجارية تبقى على نسختها. متابعة؟`)) void action(`${basePath}/publish`, { versionId, crosswalkChecksum: selected.crosswalkChecksum ?? undefined }, "تم نشر الكتالوج."); }}>نشر النسخة</button>}
              </div>
            </div>
            {typeof validation?.valid === "boolean" && <div className={validation.valid ? "ok" : "err"}>{validation.valid ? "النسخة صالحة للنشر." : !validation.errors?.length && !validation.checkedAt ? "عُدّلت المسودة بعد آخر تحقق — أعد التحقق" : arCount(validation.errors?.length ?? 0, COUNT.blockingErrors)} {validation.warnings?.length ? `(${arCount(validation.warnings.length, COUNT.warnings)})` : ""}</div>}
            {validation && Boolean(validation.errors?.length || validation.warnings?.length) && (
              <details className="validation-details">
                <summary>تفاصيل التحقق</summary>
                <ul>
                  {[...validation.errors ?? [], ...validation.warnings ?? []].map((issue, index) => (
                    <li key={`${issue.code}-${index}`}>{issue.message} {issue.entity && <bdi>({issue.entity})</bdi>}</li>
                  ))}
                </ul>
              </details>
            )}
            {busy && <p role="status" className="ok">جارٍ تنفيذ العملية…</p>}
            {message && <div className={message.kind} role="status" aria-live="polite">{message.text}</div>}
          </div>

          <div className="card">
            <h2 id="catalog-sources">المصادر والمراجعة</h2>
            <p style={{ color: "var(--dim)", fontSize: 13, lineHeight: 1.8 }}>لا يمكن نشر نسخة تحتوي على مصدر غير مراجع. اعتماد مصدر مستورد يعتمد العناصر المرتبطة به، بينما تبقى الخريطة والجداول بحاجة إلى استكمال يدوي.</p>
            <div className="source-review-list">
              {selected.contentSources.map((source) => (
                <article className="source-review-row" key={source.id}>
                  <div>
                    <strong>{source.title}</strong>
                    <div className="update-meta"><span>{sourceTypeLabel(source.sourceType)}</span>{source.locator && <span>{sourceLocatorLabel(source.locator)}</span>}{source.checksum && <span className="mono">{source.checksum.slice(0, 12)}…</span>}</div>
                  </div>
                  <div className="row source-review-actions">
                    <span className={`badge ${source.reviewStatus === "VERIFIED" ? "on" : ""}`}>{source.reviewStatus === "VERIFIED" ? "معتمد" : source.reviewStatus === "REJECTED" ? "مرفوض" : "قيد المراجعة"}</span>
                    {canEdit && source.reviewStatus !== "VERIFIED" && <button type="button" className="btn small" disabled={busy} onClick={() => reviewSource(source.id, "VERIFIED")}>اعتماد المصدر</button>}
                    {canEdit && source.reviewStatus !== "REJECTED" && <button type="button" className="btn small danger" disabled={busy} onClick={() => reviewSource(source.id, "REJECTED")}>رفض المصدر</button>}
                  </div>
                </article>
              ))}
              {!selected.contentSources.length && <p className="updates-empty">لا توجد مصادر لهذه النسخة.</p>}
            </div>
          </div>

          <div className="card">
            <h2 id="catalog-activities">الأنشطة</h2>
            <div style={{ overflowX: "auto" }}>
              <table className="responsive-table" role="table"><caption className="sr-only">أنشطة النسخة المحددة</caption><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">النشاط</th><th role="columnheader" scope="col">المنطقة</th><th role="columnheader" scope="col">المدة</th><th role="columnheader" scope="col">السعر</th><th role="columnheader" scope="col">الحالة</th><th role="columnheader" scope="col">الإجراء</th></tr></thead><tbody role="rowgroup">
                {selected.activities.map((activity) => <tr role="row" key={activity.stableKey}>
                  <td role="cell"><span className="cell-label" aria-hidden="true">النشاط</span><div className="cell-value"><strong>{activity.nameAr}</strong><div className="mono">{activity.stableKey}</div>{(activity.tags?.length ?? 0) > 0 && <div className="tag-list">{activity.tags!.join(" · ")}</div>}{!activity.descriptionAr && <div className="tag-warning">بدون وصف</div>}{(activity.tagSuggestions?.length ?? 0) > 0 && <div className="tag-warning">وسوم مقترحة بانتظار المراجعة: {activity.tagSuggestions!.length}</div>}</div></td>
                  <td role="cell"><span className="cell-label" aria-hidden="true">المنطقة</span><div className="cell-value">{activity.zone.nameAr}</div></td><td role="cell"><span className="cell-label" aria-hidden="true">المدة</span><div className="cell-value">{activity.durationMin} د</div></td><td role="cell"><span className="cell-label" aria-hidden="true">السعر</span><div className="cell-value">{priceLabel(activity.priceMinCents)}</div></td><td role="cell"><span className="cell-label" aria-hidden="true">الحالة</span><div className="cell-value"><span className="badge">{activityStatusLabel(activity.status)}</span></div></td>
                  <td role="cell" className="actions-cell"><span className="cell-label" aria-hidden="true">الإجراء</span><div className="cell-value">{canEdit && <button className="btn small ghost" onClick={() => startEdit(activity)}>تعديل</button>}</div></td>
                </tr>)}
                {!selected.activities.length && <tr role="row"><td role="cell" colSpan={6} style={{ color: "var(--dim)" }}>لا توجد أنشطة في هذه النسخة.</td></tr>}
              </tbody></table>
            </div>
            {canEdit && <div className="card" style={{ marginInline: 0, marginBottom: 0 }}>
              <h2>إضافة نشاط</h2>
              <div className="grid2">
                <div><label htmlFor="catalog-activity-key">المعرف</label><input id="catalog-activity-key" value={activityForm.stableKey} onChange={(e) => setActivityForm({ ...activityForm, stableKey: e.target.value })} placeholder="new-activity" /></div>
                <div><label htmlFor="catalog-activity-name">الاسم العربي</label><input id="catalog-activity-name" value={activityForm.nameAr} onChange={(e) => setActivityForm({ ...activityForm, nameAr: e.target.value })} /></div>
                <div><label htmlFor="catalog-activity-zone">المنطقة</label><select id="catalog-activity-zone" value={activityForm.zoneStableKey} onChange={(e) => setActivityForm({ ...activityForm, zoneStableKey: e.target.value })}><option value="">اختر المنطقة</option>{selected.zones.map((zone) => <option key={zone.stableKey} value={zone.stableKey}>{zone.nameAr}</option>)}</select></div>
                <div><label htmlFor="catalog-activity-duration">المدة بالدقائق</label><input id="catalog-activity-duration" type="number" min={1} value={activityForm.durationMin} onChange={(e) => setActivityForm({ ...activityForm, durationMin: Number(e.target.value) })} /></div>
                <div><label htmlFor="catalog-activity-price">السعر بالريال</label><input id="catalog-activity-price" type="number" min={0} step=".01" placeholder="غير معروف" value={activityForm.priceSar} onChange={(e) => setActivityForm({ ...activityForm, priceSar: e.target.value })} /></div>
                <div><label htmlFor="catalog-activity-from">يبدأ التشغيل (بتوقيت الرياض)</label><input id="catalog-activity-from" type="time" step={60} required dir="ltr" value={minutesToClock(activityForm.scheduleFromMin)} onChange={(e) => { const minutes = clockToMinutes(e.target.value, false); if (minutes != null) setActivityForm({ ...activityForm, scheduleFromMin: minutes }); }} /></div>
                <div><label htmlFor="catalog-activity-to">ينتهي التشغيل</label><input id="catalog-activity-to" type="time" step={60} required dir="ltr" aria-describedby="catalog-activity-to-hint" value={minutesToClock(activityForm.scheduleToMin)} onChange={(e) => { const minutes = clockToMinutes(e.target.value, true); if (minutes != null) setActivityForm({ ...activityForm, scheduleToMin: minutes }); }} /><small id="catalog-activity-to-hint" style={{ color: "var(--dim)" }}>00:00 تعني منتصف الليل.</small></div>
                <div><label htmlFor="catalog-activity-family">ملائم للعائلات</label><select id="catalog-activity-family" value={String(activityForm.familyFriendly)} onChange={(e) => setActivityForm({ ...activityForm, familyFriendly: e.target.value === "true" })}><option value="false">غير مؤكد</option><option value="true">مؤكد</option></select></div>
                <div><label htmlFor="catalog-activity-source">مرجع السعر والملاءمة والمواعيد</label><input id="catalog-activity-source" maxLength={240} value={activityForm.factsSource} onChange={(e) => setActivityForm({ ...activityForm, factsSource: e.target.value })} /></div>
              </div>
              <button className="btn" style={{ marginTop: 12 }} disabled={busy} onClick={createActivity}>إضافة النشاط</button>
            </div>}
          </div>

          {canEdit && <div className="card">
            <h2>إضافة منطقة للخريطة</h2>
            <div className="grid2">
              <div><label htmlFor="catalog-zone-key">المعرف</label><input id="catalog-zone-key" value={zoneForm.stableKey} onChange={(e) => setZoneForm({ ...zoneForm, stableKey: e.target.value })} placeholder="new-zone" /></div>
              <div><label htmlFor="catalog-zone-name">اسم المنطقة</label><input id="catalog-zone-name" value={zoneForm.nameAr} onChange={(e) => setZoneForm({ ...zoneForm, nameAr: e.target.value })} /></div>
              <div><label htmlFor="catalog-zone-x">موضع X</label><input id="catalog-zone-x" type="number" value={zoneForm.mapX} onChange={(e) => setZoneForm({ ...zoneForm, mapX: Number(e.target.value) })} /></div>
              <div><label htmlFor="catalog-zone-y">موضع Y</label><input id="catalog-zone-y" type="number" value={zoneForm.mapY} onChange={(e) => setZoneForm({ ...zoneForm, mapY: Number(e.target.value) })} /></div>
            </div>
            <button className="btn" style={{ marginTop: 12 }} disabled={busy} onClick={createZone}>إضافة المنطقة</button>
          </div>}

          {canEdit && selected.status === "DRAFT" && <section className="card" aria-labelledby="catalog-capacity-title">
            <h2 id="catalog-capacity-title">اعتماد سعة منطقة</h2>
            <p>أدخل أقصى عدد زوار معتمد للمنطقة مع مرجع فريق التشغيل. تتحول السعة إلى أساس لقياس الإشغال بعد النشر.</p>
            <form onSubmit={(event) => {
              event.preventDefault();
              void action(`${basePath}/zones`, { versionId, zoneKey: capacityForm.zoneKey, capacity: Number(capacityForm.capacity), source: capacityForm.source }, "حُفظت السعة ومرجعها. تحقّق من المسودة قبل النشر.", "PATCH");
            }}>
              <div className="grid2">
                <div><label htmlFor="catalog-capacity-zone">المنطقة</label><select id="catalog-capacity-zone" required value={capacityForm.zoneKey} onChange={(event) => {
                  const selectedZone = selected.zones.find((zone) => zone.stableKey === event.target.value);
                  setCapacityForm({ zoneKey: event.target.value, capacity: selectedZone?.capacity?.toString() ?? "", source: "" });
                }}><option value="">اختر المنطقة</option>{selected.zones.map((zone) => <option key={zone.id} value={zone.stableKey}>{zone.nameAr}</option>)}</select></div>
                <div><label htmlFor="catalog-capacity-number">السعة المعتمدة</label><input id="catalog-capacity-number" type="number" min={1} max={1000000} required value={capacityForm.capacity} onChange={(event) => setCapacityForm({ ...capacityForm, capacity: event.target.value })} /></div>
              </div>
              <label htmlFor="catalog-capacity-source">مرجع اعتماد السعة</label>
              <input id="catalog-capacity-source" required maxLength={240} value={capacityForm.source} onChange={(event) => setCapacityForm({ ...capacityForm, source: event.target.value })} />
              <button type="submit" className="btn" disabled={busy}>احفظ السعة والمرجع</button>
            </form>
          </section>}

          <div className="card">
            <h2 id="catalog-locations">المواقع والخدمات على الخريطة</h2>
            <div style={{ overflowX: "auto" }}>
              <table className="responsive-table" role="table"><caption className="sr-only">مواقع الخريطة والخدمات</caption><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">الموقع</th><th role="columnheader" scope="col">النوع</th><th role="columnheader" scope="col">المنطقة</th><th role="columnheader" scope="col">الحالة</th></tr></thead><tbody role="rowgroup">
                {selected.routeNodes.map((node) => <tr role="row" key={node.id}><td role="cell"><span className="cell-label" aria-hidden="true">الموقع</span><div className="cell-value"><strong>{node.label}</strong><div className="mono">{node.stableKey}</div></div></td><td role="cell"><span className="cell-label" aria-hidden="true">النوع</span><div className="cell-value">{nodeTypeLabel(node.type)}</div></td><td role="cell"><span className="cell-label" aria-hidden="true">المنطقة</span><div className="cell-value">{selected.zones.find((zone) => zone.id === node.zoneId)?.nameAr ?? "—"}</div></td><td role="cell"><span className="cell-label" aria-hidden="true">الحالة</span><div className="cell-value">{nodeStatusLabel(node.status)}</div></td></tr>)}
                {!selected.routeNodes.length && <tr role="row"><td role="cell" colSpan={4} style={{ color: "var(--dim)" }}>لا توجد مواقع بعد.</td></tr>}
              </tbody></table>
            </div>
            {canEdit && <div className="card" style={{ marginInline: 0, marginBottom: 0 }}>
              <h3>إضافة موقع خدمة أو معلم</h3>
              <div className="grid2">
                <div><label htmlFor="catalog-node-key">المعرف</label><input id="catalog-node-key" value={nodeForm.stableKey} onChange={(e) => setNodeForm({ ...nodeForm, stableKey: e.target.value })} placeholder="service-restrooms" /></div>
                <div><label htmlFor="catalog-node-label">الاسم</label><input id="catalog-node-label" value={nodeForm.label} onChange={(e) => setNodeForm({ ...nodeForm, label: e.target.value })} /></div>
                <div><label htmlFor="catalog-node-type">النوع</label><select id="catalog-node-type" value={nodeForm.type} onChange={(e) => setNodeForm({ ...nodeForm, type: e.target.value })}><option value="SERVICE">خدمة</option><option value="LANDMARK">معلم</option><option value="ENTRANCE">بوابة</option><option value="ZONE">منطقة</option></select></div>
                <div><label htmlFor="catalog-node-zone">المنطقة</label><select id="catalog-node-zone" value={nodeForm.zoneStableKey} onChange={(e) => setNodeForm({ ...nodeForm, zoneStableKey: e.target.value })}><option value="">بدون منطقة</option>{selected.zones.map((zone) => <option key={zone.stableKey} value={zone.stableKey}>{zone.nameAr}</option>)}</select></div>
                <div><label htmlFor="catalog-node-x">موضع X</label><input id="catalog-node-x" type="number" value={nodeForm.x} onChange={(e) => setNodeForm({ ...nodeForm, x: Number(e.target.value) })} /></div>
                <div><label htmlFor="catalog-node-y">موضع Y</label><input id="catalog-node-y" type="number" value={nodeForm.y} onChange={(e) => setNodeForm({ ...nodeForm, y: Number(e.target.value) })} /></div>
                <div><label htmlFor="catalog-node-aliases">مرادفات مفصولة بفواصل</label><input id="catalog-node-aliases" value={nodeForm.aliases} onChange={(e) => setNodeForm({ ...nodeForm, aliases: e.target.value })} placeholder="حمام, دورة مياه" /></div>
                <div><label htmlFor="catalog-node-description">وصف مختصر</label><input id="catalog-node-description" value={nodeForm.description} onChange={(e) => setNodeForm({ ...nodeForm, description: e.target.value })} /></div>
                <div><label htmlFor="catalog-node-accessible">إمكانية الوصول إلى الموقع</label><select id="catalog-node-accessible" value={String(nodeForm.accessible)} onChange={(e) => setNodeForm({ ...nodeForm, accessible: e.target.value === "true" })}><option value="false">غير مؤكدة</option><option value="true">تم التحقق منها ميدانيًا</option></select></div>
              </div>
              <button className="btn" style={{ marginTop: 12 }} disabled={busy} onClick={createNode}>إضافة الموقع</button>
            </div>}
          </div>

          <NavigationSettings eventSlug={eventSlug} />

          <WalkingSegments key={versionId} nodes={selected.routeNodes} edges={selected.routeEdges} sources={selected.contentSources}
            canEdit={canEdit} busy={busy}
            onSave={async (segment) => { await action(`${basePath}/edges`, { versionId, ...segment }, "حُفظ مقطع المشي في المسودة."); }} />

          {editing && <div className="card">
            <h2>تعديل النشاط</h2>
            <div className="grid2">
              <div><label htmlFor="catalog-edit-name">الاسم العربي</label><input id="catalog-edit-name" value={editName} onChange={(e) => setEditName(e.target.value)} /></div>
              <div><label htmlFor="catalog-edit-duration">المدة بالدقائق</label><input id="catalog-edit-duration" type="number" min={1} value={editDuration} onChange={(e) => setEditDuration(Number(e.target.value))} /></div>
              <div><label htmlFor="catalog-edit-price">السعر الأدنى بالريال</label><input id="catalog-edit-price" type="number" min={0} step=".01" placeholder="غير معروف" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} /></div>
              <div><label htmlFor="catalog-edit-max-price">السعر الأعلى بالريال</label><input id="catalog-edit-max-price" type="number" min={0} step=".01" placeholder="غير معروف" value={editMaxPrice} onChange={(e) => setEditMaxPrice(e.target.value)} /></div>
              <div><label htmlFor="catalog-edit-family">ملائم للعائلات</label><select id="catalog-edit-family" value={String(editFamily)} onChange={(e) => setEditFamily(e.target.value === "true")}><option value="false">غير مؤكد</option><option value="true">مؤكد</option></select></div>
              <div><label htmlFor="catalog-edit-age">العمر الأدنى</label><input id="catalog-edit-age" type="number" min={0} max={120} value={editAge} onChange={(e) => setEditAge(e.target.value)} /></div>
              <div><label htmlFor="catalog-edit-start">استبدال بداية التشغيل (الرياض)</label><input id="catalog-edit-start" type="datetime-local" value={editSchedule.start} onChange={(e) => setEditSchedule({ ...editSchedule, start: e.target.value })} /></div>
              <div><label htmlFor="catalog-edit-end">استبدال نهاية التشغيل (الرياض)</label><input id="catalog-edit-end" type="datetime-local" value={editSchedule.end} onChange={(e) => setEditSchedule({ ...editSchedule, end: e.target.value })} /></div>
              <div><label htmlFor="catalog-edit-source">مرجع السعر والملاءمة والمواعيد</label><input id="catalog-edit-source" maxLength={240} value={editSource} onChange={(e) => setEditSource(e.target.value)} /></div>
              <div style={{ gridColumn: "1 / -1" }}><label htmlFor="catalog-edit-description">الوصف (يظهر للزائر ويعتمد عليه ونيس)</label><textarea id="catalog-edit-description" rows={3} maxLength={2000} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} /></div>
              <div style={{ gridColumn: "1 / -1" }}><label htmlFor="catalog-edit-tags">الوسوم (3 على الأقل، مفصولة بفاصلة)</label><input id="catalog-edit-tags" value={editTags} placeholder="طيران، إثارة، تصوير" onChange={(e) => setEditTags(e.target.value)} /></div>
              {(() => {
                // Audit 3.4: «دلّني» ends at the activity's door. Only open locations in its own zone.
                const activity = selected?.activities.find((item) => item.stableKey === editing);
                const zoneId = selected?.zones.find((zone) => zone.stableKey === activity?.zone.stableKey)?.id;
                const options = (selected?.routeNodes ?? []).filter((node) => node.zoneId === zoneId && node.status === "open");
                return <div style={{ gridColumn: "1 / -1" }}><label htmlFor="catalog-edit-entrance">مدخل النشاط على الخريطة (عنده ينتهي «دلّني»)</label>
                  <select id="catalog-edit-entrance" value={editEntrance} onChange={(e) => setEditEntrance(e.target.value)}>
                    <option value="">وسط المنطقة</option>
                    {options.map((node) => <option key={node.id} value={node.stableKey}>{node.label} · {node.stableKey}</option>)}
                  </select></div>;
              })()}
            </div>
            {(() => {
              const suggestions = selected.activities.find((activity) => activity.stableKey === editing)?.tagSuggestions ?? [];
              if (!suggestions.length) return null;
              return <div className="tag-review" role="group" aria-label="وسوم مقترحة بانتظار اعتمادك">
                <p>وسوم مقترحة آليًا. ما تُستخدم في المطابقة إلا بعد اعتمادك:</p>
                {suggestions.map((tag) => <span key={tag} className="row">
                  <strong>{tag}</strong>
                  <button type="button" className="btn small" disabled={busy} onClick={() => void action(`${basePath}/items/${encodeURIComponent(editing)}`, { versionId, approveTags: [tag] }, `اعتُمد الوسم «${tag}».`, "PATCH").then((ok) => { if (ok) setEditTags((current) => [...current.split(/[،,]/).map((item) => item.trim()).filter(Boolean), tag].join("، ")); })}>اعتماد</button>
                  <button type="button" className="btn small ghost" disabled={busy} onClick={() => void action(`${basePath}/items/${encodeURIComponent(editing)}`, { versionId, rejectTags: [tag] }, `رُفض الوسم «${tag}».`, "PATCH")}>رفض</button>
                </span>)}
              </div>;
            })()}
            <div className="row" style={{ marginTop: 16 }}><button className="btn primary" disabled={busy} onClick={saveEdit}>حفظ</button><button className="btn ghost" onClick={() => setEditing(null)}>إلغاء</button></div>
          </div>}
        </>}
      </>}
      </main>
    </div>
  );
}
