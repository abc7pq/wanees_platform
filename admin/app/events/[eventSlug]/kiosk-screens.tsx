"use client";

// Kiosk screens (audit 5.2): register a screen at one open walkway node of the published catalog, hand its
// one-time link to the screen, and revoke it. Only the token's hash is stored, so the link is shown once.
import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "@/lib/admin-fetch";

type Kiosk = { id: string; name: string; nodeKey: string; status: "active" | "revoked"; revokedAt: string | null; lastSeenAt: string | null; createdAt: string };
type Node = { stableKey: string; label: string; type: string; status: string };
type Created = { id: string; name: string; link: string; qr: string | null };

const dateTime = new Intl.DateTimeFormat("ar-SA-u-nu-latn", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" });

/** The screen's address. The token rides in the fragment, which browsers never send to a server. */
export function kioskLink(visitorBase: string, eventSlug: string, token: string) {
  return `${new URL(`/kiosk/${encodeURIComponent(eventSlug)}`, visitorBase).href}#kiosk=${token}`;
}

export function KioskScreens({ eventSlug, publishedVersionId, visitorBase }: { eventSlug: string; publishedVersionId: string | null; visitorBase: string }) {
  const path = `/api/v1/events/${encodeURIComponent(eventSlug)}/kiosks`;
  const [kiosks, setKiosks] = useState<Kiosk[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [form, setForm] = useState({ name: "", nodeKey: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const list = await adminFetch(path);
    if (!list.ok) throw new Error("kiosks unavailable");
    setKiosks((await list.json()).data as Kiosk[]);
    if (publishedVersionId) {
      const catalog = await adminFetch(`/api/v1/events/${encodeURIComponent(eventSlug)}/catalog?versionId=${encodeURIComponent(publishedVersionId)}`);
      if (catalog.ok) {
        const routeNodes = ((await catalog.json()).data?.selectedVersion?.routeNodes ?? []) as Node[];
        setNodes(routeNodes.filter((node) => node.status === "open"));
      }
    }
    setState("ready");
  }, [path, eventSlug, publishedVersionId]);

  useEffect(() => { load().catch(() => setState("error")); }, [load]);

  const nodeLabel = (key: string) => nodes.find((node) => node.stableKey === key)?.label ?? key;

  const add = async () => {
    if (!form.name.trim() || !form.nodeKey) return;
    setBusy(true);
    setMessage(null);
    setCreated(null);
    setCopied(false);
    try {
      const response = await adminFetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.name.trim(), nodeKey: form.nodeKey }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error?.message ?? "تعذر إضافة الشاشة.");
      const link = kioskLink(visitorBase, eventSlug, payload.data.token);
      let qr: string | null = null;
      try {
        const { default: qrcode } = await import("qrcode");
        qr = await qrcode.toDataURL(link, { width: 480, errorCorrectionLevel: "M" });
      } catch { /* the link alone is enough */ }
      setCreated({ id: payload.data.id, name: payload.data.name, link, qr });
      setForm({ name: "", nodeKey: "" });
      setKiosks((current) => [payload.data as Kiosk, ...current]);
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "تعذر إضافة الشاشة.", kind: "err" });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (kiosk: Kiosk) => {
    if (!window.confirm(`إيقاف «${kiosk.name}»؟ يتوقف رابطها فورًا ولا يمكن إعادة تشغيله؛ للتشغيل مرة أخرى أضف شاشة جديدة.`)) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await adminFetch(`${path}/${encodeURIComponent(kiosk.id)}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error?.message ?? "تعذر إيقاف الشاشة.");
      setKiosks((current) => current.map((item) => item.id === kiosk.id ? { ...item, status: "revoked", revokedAt: new Date().toISOString() } : item));
      if (created?.id === kiosk.id) setCreated(null);
      setMessage({ text: `أُوقفت «${kiosk.name}».`, kind: "ok" });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "تعذر إيقاف الشاشة.", kind: "err" });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.link);
      setCopied(true);
    } catch {
      setMessage({ text: "تعذر النسخ تلقائيًا. حدّد الرابط وانسخه يدويًا.", kind: "err" });
    }
  };

  if (state === "loading") return <div className="card" role="status">جارٍ تحميل شاشات الاستعلام…</div>;
  if (state === "error") {
    return (
      <div className="card" role="alert">
        <h2 id="kiosk-screens">شاشات الاستعلام</h2>
        <p className="err">تعذر تحميل الشاشات.</p>
        <button className="btn" type="button" onClick={() => { setState("loading"); load().catch(() => setState("error")); }}>إعادة المحاولة</button>
      </div>
    );
  }

  const active = kiosks.filter((kiosk) => kiosk.status === "active").length;
  return (
    <section className="card" aria-labelledby="kiosk-screens">
      <h2 id="kiosk-screens">شاشات الاستعلام</h2>
      <p className="muted">
        شاشة ثابتة في الموقع يسأل منها الزوار ونيس، ويُحسب المشي فيها من مكانها. لا تحفظ الشاشة أي محادثة، وتنسى الزائر بعد دقيقة بلا استخدام.
        {kiosks.length > 0 && ` النشطة الآن: ${active} من ${kiosks.length}.`}
      </p>

      {created && <div className="kiosk-created" role="status" aria-live="polite">
        <p><strong>أُضيفت «{created.name}».</strong> افتح هذا الرابط على الشاشة نفسها. يظهر مرة واحدة فقط ولا يُحفظ عندنا، فإذا ضاع أوقف الشاشة وأضف غيرها.</p>
        <input className="mono" dir="ltr" readOnly value={created.link} aria-label="رابط الشاشة" onFocus={(event) => event.currentTarget.select()} />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn primary" type="button" onClick={copy}>{copied ? "نُسخ الرابط" : "نسخ الرابط"}</button>
          <button className="btn ghost" type="button" onClick={() => setCreated(null)}>تم، أخفِ الرابط</button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {created.qr && <img className="kiosk-created-qr" src={created.qr} width={160} height={160} alt="رمز QR لرابط الشاشة، امسحه من جهاز الشاشة" />}
      </div>}

      {!publishedVersionId ? <p className="tag-warning">انشر الكتالوج أولًا؛ الشاشة توضع على نقطة من ممراته المنشورة.</p> : <div className="grid2">
        <div><label htmlFor="kiosk-name">اسم الشاشة</label><input id="kiosk-name" maxLength={80} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="مثال: شاشة البوابة الرئيسية" /></div>
        <div><label htmlFor="kiosk-node">مكانها على الممرات</label><select id="kiosk-node" value={form.nodeKey} onChange={(event) => setForm({ ...form, nodeKey: event.target.value })}>
          <option value="">اختر النقطة</option>
          {nodes.map((node) => <option key={node.stableKey} value={node.stableKey}>{node.label}</option>)}
        </select></div>
        <div><button className="btn primary" type="button" disabled={busy || !form.name.trim() || !form.nodeKey} onClick={add}>إضافة شاشة</button></div>
      </div>}

      {message && <p className={message.kind} role={message.kind === "ok" ? "status" : "alert"}>{message.text}</p>}

      {kiosks.length === 0 && <p className="muted">لا توجد شاشات بعد.</p>}
      {kiosks.length > 0 && active === 0 && <p className="muted">لا توجد شاشات نشطة.</p>}
      {active > 0 && table(kiosks.filter((kiosk) => kiosk.status === "active"), "الشاشات النشطة في هذه الفعالية")}
      {/* Revoked screens stay for the record (the nightly eval adds and revokes one every night), folded away. */}
      {kiosks.length > active && <details className="kiosk-revoked">
        <summary>الموقوفة ({kiosks.length - active})</summary>
        {table(kiosks.filter((kiosk) => kiosk.status !== "active"), "الشاشات الموقوفة")}
      </details>}
    </section>
  );

  function table(rows: Kiosk[], caption: string) {
    return (
        <table className="responsive-table" role="table" style={{ marginTop: 12 }}><caption className="sr-only">{caption}</caption>
          <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">الشاشة</th><th role="columnheader" scope="col">المكان</th><th role="columnheader" scope="col">الحالة</th><th role="columnheader" scope="col">آخر استخدام</th><th role="columnheader" scope="col">الإجراء</th></tr></thead>
          <tbody role="rowgroup">
            {rows.map((kiosk) => <tr role="row" key={kiosk.id}>
              <td role="cell"><span className="cell-label" aria-hidden="true">الشاشة</span><div className="cell-value"><strong>{kiosk.name}</strong></div></td>
              <td role="cell"><span className="cell-label" aria-hidden="true">المكان</span><div className="cell-value">{nodeLabel(kiosk.nodeKey)}</div></td>
              <td role="cell"><span className="cell-label" aria-hidden="true">الحالة</span><div className="cell-value"><span className="badge">{kiosk.status === "active" ? "نشطة" : "موقوفة"}</span></div></td>
              <td role="cell"><span className="cell-label" aria-hidden="true">آخر استخدام</span><div className="cell-value">{kiosk.lastSeenAt ? dateTime.format(new Date(kiosk.lastSeenAt)) : "لم تُستخدم بعد"}</div></td>
              <td role="cell" className="actions-cell"><span className="cell-label" aria-hidden="true">الإجراء</span><div className="cell-value">
                {kiosk.status === "active" && <button className="btn small ghost" type="button" disabled={busy} onClick={() => revoke(kiosk)}>إيقاف</button>}
              </div></td>
            </tr>)}
          </tbody>
        </table>
    );
  }
}
