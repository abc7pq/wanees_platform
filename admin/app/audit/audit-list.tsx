"use client";

import { useCallback, useEffect, useState } from "react";
import { Topbar } from "../dashboard";
import { adminFetch } from "@/lib/admin-fetch";
import { auditActionLabel, auditEntityLabel } from "@/lib/arabic-labels";

type Field = { key: string; value: string };
type Entry = {
  id: string;
  createdAt: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actor: { displayName: string } | null;
  before: Field[];
  after: Field[];
  requestId: string | null;
};

const dateTime = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" });

// The page cannot name its own entry in the shared topbar yet, so none is marked current there.

function Summary({ title, fields }: { title: string; fields: Field[] }) {
  if (!fields.length) return null;
  return (
    <div style={{ fontSize: 12.5, marginBlockEnd: 6 }}>
      <span style={{ color: "var(--dim)" }}>{title}</span>
      <dl className="audit-fields">
        {fields.map((field, index) => (
          <div key={`${field.key}-${index}`}>
            <dt><bdi className="mono" dir="ltr">{field.key}</bdi></dt>
            <dd><bdi dir="auto">{field.value}</bdi></dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function AuditList() {
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [facets, setFacets] = useState<{ actions: string[]; entityTypes: string[] }>({ actions: [], entityTypes: [] });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "forbidden">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const fetchPage = useCallback(async (cursor: string | null) => {
    const params = new URLSearchParams();
    if (action) params.set("action", action);
    if (entityType) params.set("entityType", entityType);
    if (cursor) params.set("cursor", cursor);
    const res = await adminFetch(`/api/v1/audit?${params}`, { credentials: "include" });
    if (res.status === 403) return "forbidden" as const;
    const payload = await res.json().catch(() => null);
    if (!res.ok) throw new Error(payload?.error?.message ?? `HTTP ${res.status}`);
    return payload.data as { entries: Entry[]; nextCursor: string | null; facets: { actions: string[]; entityTypes: string[] } | null };
  }, [action, entityType]);

  const load = useCallback(async () => {
    setState("loading");
    setError("");
    try {
      const page = await fetchPage(null);
      if (page === "forbidden") { setState("forbidden"); return; }
      setEntries(page.entries);
      setNextCursor(page.nextCursor);
      if (page.facets) setFacets(page.facets);
      setState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تحميل السجل.");
      setState("error");
    }
  }, [fetchPage]);

  useEffect(() => { void load(); }, [load]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    setError("");
    try {
      const page = await fetchPage(nextCursor);
      if (page === "forbidden") { setState("forbidden"); return; }
      setEntries((current) => [...current, ...page.entries]);
      setNextCursor(page.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تحميل المزيد.");
    } finally {
      setLoadingMore(false);
    }
  }

  const filtered = Boolean(action || entityType);

  return (
    <div className="wrap">
      <Topbar current="audit" />
      <main id="main-content" className="main-content" tabIndex={-1}>
        <div className="card" aria-busy={state === "loading"}>
          <header className="workspace-heading">
            <div>
              <h1>سجل التدقيق</h1>
              <p style={{ fontSize: 13 }}>من غيّر ماذا ومتى في جهتك، الأحدث أولًا. الأوقات بتوقيت الرياض، والأسرار وأرقام الجوال لا تظهر هنا.</p>
            </div>
          </header>

          {state === "forbidden" && <p className="err" role="alert">سجل التدقيق متاح للمالك والمدير فقط.</p>}

          {state !== "forbidden" && (
            <div className="grid2" role="search" style={{ marginBottom: 12 }}>
              <div>
                <label htmlFor="audit-action">الإجراء</label>
                <select id="audit-action" value={action} onChange={(event) => setAction(event.target.value)} style={{ width: "100%" }}>
                  <option value="">كل الإجراءات</option>
                  {[...new Set([...facets.actions, ...(action ? [action] : [])])].map((code) => <option key={code} value={code}>{auditActionLabel(code)}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="audit-entity">نوع السجل</label>
                <select id="audit-entity" value={entityType} onChange={(event) => setEntityType(event.target.value)} style={{ width: "100%" }}>
                  <option value="">كل الأنواع</option>
                  {[...new Set([...facets.entityTypes, ...(entityType ? [entityType] : [])])].map((code) => <option key={code} value={code}>{auditEntityLabel(code)}</option>)}
                </select>
              </div>
            </div>
          )}

          {state === "loading" && <p style={{ color: "var(--dim)" }}>جارٍ التحميل…</p>}
          {error && <p className="err" role="alert">{error} <button type="button" className="btn small ghost" onClick={() => void load()}>إعادة المحاولة</button></p>}
          {state === "ready" && entries.length === 0 && <p style={{ color: "var(--dim)" }}>{filtered ? "ما فيه سجلات بهذا التصفية." : "ما سُجّل أي إجراء بعد."}</p>}

          {state === "ready" && entries.length > 0 && (
            <table className="responsive-table">
              <caption className="sr-only">سجل التدقيق</caption>
              <thead>
                <tr><th scope="col">الوقت</th><th scope="col">المنفّذ</th><th scope="col">الإجراء</th><th scope="col">السجل</th><th scope="col">التفاصيل</th></tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td><span className="cell-label" aria-hidden="true">الوقت</span><div className="cell-value"><time dateTime={entry.createdAt}>{dateTime.format(new Date(entry.createdAt))}</time></div></td>
                    <td><span className="cell-label" aria-hidden="true">المنفّذ</span><div className="cell-value">{entry.actor ? <bdi>{entry.actor.displayName}</bdi> : <span style={{ color: "var(--dim)" }}>النظام</span>}</div></td>
                    <td><span className="cell-label" aria-hidden="true">الإجراء</span><div className="cell-value">{auditActionLabel(entry.action)}</div></td>
                    <td><span className="cell-label" aria-hidden="true">السجل</span><div className="cell-value">{auditEntityLabel(entry.entityType)}{entry.entityId && <div className="mono" dir="ltr">{entry.entityId}</div>}</div></td>
                    <td><span className="cell-label" aria-hidden="true">التفاصيل</span><div className="cell-value">
                      {!entry.before.length && !entry.after.length ? <span style={{ color: "var(--dim)" }}>—</span> : <>
                        <Summary title="قبل" fields={entry.before} />
                        <Summary title="بعد" fields={entry.after} />
                      </>}
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {state === "ready" && nextCursor && (
            <div className="row" style={{ marginTop: 12 }}>
              <button type="button" className="btn small ghost" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "جارٍ التحميل…" : "عرض الأقدم"}</button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
