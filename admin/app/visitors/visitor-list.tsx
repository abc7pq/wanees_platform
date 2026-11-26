"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Topbar } from "../dashboard";
import { adminFetch } from "@/lib/admin-fetch";

type VisitorRow = {
  id: string;
  name: string;
  phone: string;
  firstSeenAt: string;
  lastSeenAt: string;
  visitCount: number;
  events: string[];
  averageRating: number | null;
};

type VisitorDetail = {
  id: string;
  name: string;
  phone: string;
  phoneMasked?: boolean;
  createdAt: string;
  consentedAt: string;
  visits: { id: string; startedAt: string; rating: number | null; companions: string | null; partySize: number | null; itineraryActivityKeys: string[]; event: { slug: string; name: string } }[];
};

const dateTime = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" });
const formatDate = (iso: string) => dateTime.format(new Date(iso));

export default function VisitorList() {
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<VisitorRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [state, setState] = useState<"loading" | "ready" | "error" | "forbidden">("loading");
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<VisitorDetail | null>(null);
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    setState("loading");
    setError("");
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (applied) params.set("q", applied);
      const res = await adminFetch(`/api/v1/visitors?${params}`, { credentials: "include" });
      if (res.status === 401) { location.href = "/login"; return; }
      if (res.status === 403) { setState("forbidden"); return; }
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error?.message ?? `HTTP ${res.status}`);
      setRows(payload.data.visitors);
      setTotal(payload.data.total);
      setPageSize(payload.data.pageSize);
      setState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تحميل الزوار.");
      setState("error");
    }
  }, [applied, page]);

  useEffect(() => { void load(); }, [load]);

  function search(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setApplied(query.trim());
  }

  async function openDetail(id: string, reveal = false) {
    setBusyId(id);
    try {
      // Phone numbers stay masked unless the operator explicitly reveals one; each reveal is audited.
      const res = await adminFetch(`/api/v1/visitors/${encodeURIComponent(id)}${reveal ? "?reveal=phone" : ""}`, { credentials: "include" });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error?.message ?? "تعذر فتح سجل الزائر.");
      setDetail(payload.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر فتح سجل الزائر.");
    } finally {
      setBusyId("");
    }
  }

  async function remove(row: { id: string; name: string }) {
    if (!window.confirm(`حذف «${row.name}» وكل زياراته نهائيًا؟ ما يمكن التراجع.`)) return;
    setBusyId(row.id);
    try {
      const res = await adminFetch(`/api/v1/visitors/${encodeURIComponent(row.id)}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? "تعذر الحذف.");
      setDetail(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر الحذف.");
    } finally {
      setBusyId("");
    }
  }

  const exportHref = `/api/v1/visitors?format=csv${applied ? `&q=${encodeURIComponent(applied)}` : ""}`;
  const confirmUnmaskedExport = (event: { preventDefault: () => void }) => {
    if (!window.confirm("سيُصدَّر الملف بأرقام الجوال كاملة ويُسجَّل ذلك في سجل التدقيق. متابعة؟")) event.preventDefault();
  };
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="wrap">
      <Topbar current="visitors" />
      <main id="main-content" className="main-content" tabIndex={-1}>
        <div className="card" aria-busy={state === "loading"}>
          <header className="workspace-heading">
            <div>
              <h1>الزوار المسجّلون</h1>
              <p style={{ color: "var(--dim)", fontSize: 13 }}>بيانات شخصية: كل عرض وتصدير وحذف يُسجَّل في سجل التدقيق.</p>
            </div>
            {state === "ready" && total > 0 && <div className="row" style={{ gap: 8 }}>
              <a className="btn" href={exportHref} download>تصدير CSV (أرقام مخفية)</a>
              <a className="btn ghost" href={`${exportHref}&reveal=phone`} download onClick={confirmUnmaskedExport}>تصدير بالأرقام كاملة</a>
            </div>}
          </header>

          {state === "forbidden" && <p className="err" role="alert">عرض بيانات الزوار متاح للمالك والمدير فقط.</p>}

          {state !== "forbidden" && (
            <form className="row" role="search" onSubmit={search} style={{ gap: 8, margin: "12px 0" }}>
              <label htmlFor="visitor-search" className="sr-only">ابحث بالاسم أو الرقم</label>
              <input id="visitor-search" type="search" placeholder="ابحث بالاسم أو الرقم" value={query} onChange={(event) => setQuery(event.target.value)} style={{ flex: 1, minWidth: 0 }} />
              <button type="submit" className="btn primary">بحث</button>
            </form>
          )}

          {state === "loading" && <p style={{ color: "var(--dim)" }}>جارٍ التحميل…</p>}
          {error && <p className="err" role="alert">{error} <button type="button" className="btn small ghost" onClick={() => void load()}>إعادة المحاولة</button></p>}
          {state === "ready" && rows.length === 0 && <p style={{ color: "var(--dim)" }}>{applied ? "ما فيه نتائج لهذا البحث." : "ما سجّل أي زائر حتى الآن."}</p>}

          {state === "ready" && rows.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table>
                <caption className="sr-only">قائمة الزوار المسجّلين</caption>
                <thead>
                  <tr><th scope="col">الاسم</th><th scope="col">الجوال</th><th scope="col">الزيارات</th><th scope="col">آخر زيارة</th><th scope="col">التقييم</th><th scope="col"><span className="sr-only">إجراءات</span></th></tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td><bdi>{row.name}</bdi></td>
                      <td><span className="mono" dir="ltr">{row.phone}</span></td>
                      <td>{row.visitCount}</td>
                      <td>{formatDate(row.lastSeenAt)}</td>
                      <td>{row.averageRating ?? "—"}</td>
                      <td>
                        <button type="button" className="btn small" disabled={busyId === row.id} onClick={() => void openDetail(row.id)} aria-label={`سجل ${row.name}`}>السجل</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {state === "ready" && pages > 1 && (
            <nav className="row" aria-label="صفحات الزوار" style={{ gap: 8, marginTop: 12 }}>
              <button type="button" className="btn small ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>السابق</button>
              <span style={{ color: "var(--dim)" }}>صفحة {page} من {pages} · {total} زائر</span>
              <button type="button" className="btn small ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>التالي</button>
            </nav>
          )}
        </div>

        {detail && (
          <section className="card" aria-labelledby="visitor-detail-title" style={{ marginTop: 16 }}>
            <header className="workspace-heading">
              <div>
                <h2 id="visitor-detail-title"><bdi>{detail.name}</bdi></h2>
                <p style={{ color: "var(--dim)", fontSize: 13 }}>
                  {detail.phoneMasked === false
                    ? <a className="mono" dir="ltr" href={`tel:${detail.phone}`}>{detail.phone}</a>
                    : <><span className="mono" dir="ltr">{detail.phone}</span> <button type="button" className="btn small ghost" disabled={busyId === detail.id} onClick={() => void openDetail(detail.id, true)}>إظهار الرقم</button></>} · مسجّل منذ {formatDate(detail.createdAt)} · وافق على الحفظ {formatDate(detail.consentedAt)}
                </p>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn danger" disabled={busyId === detail.id} onClick={() => void remove(detail)}>حذف الزائر</button>
                <button type="button" className="btn ghost" onClick={() => setDetail(null)}>إغلاق</button>
              </div>
            </header>
            {detail.visits.length === 0 ? <p style={{ color: "var(--dim)" }}>ما فيه زيارات مسجّلة.</p> : (
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead><tr><th scope="col">الفعالية</th><th scope="col">التاريخ</th><th scope="col">مع</th><th scope="col">الأنشطة</th><th scope="col">التقييم</th></tr></thead>
                  <tbody>
                    {detail.visits.map((visit) => (
                      <tr key={visit.id}>
                        <td>{visit.event.name}</td>
                        <td>{formatDate(visit.startedAt)}</td>
                        <td>{visit.companions ?? "—"}{visit.partySize ? ` (${visit.partySize})` : ""}</td>
                        <td>{visit.itineraryActivityKeys.length}</td>
                        <td>{visit.rating ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
