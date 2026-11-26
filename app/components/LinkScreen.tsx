"use client";

import { useEffect, useRef, useState } from "react";

type Request = (path: string, init?: RequestInit) => Promise<any>;
type Shown = { code: string; expiresAt: string; qrSvg: string };
type Status = "none" | "pending" | "expired" | "active" | "idle" | "revoked";

// «اربط بشاشة» (audit 4.3): the phone shows a code and a QR for 10 minutes; a screen at the venue that
// enters it can show this visit's plan, read-only, until it is idle for a minute, says «انتهيت», or the
// visitor stops it here.
export function LinkScreen({ eventSlug, request }: { eventSlug: string; request: Request }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const [status, setStatus] = useState<Status>("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const path = `/api/v1/events/${encodeURIComponent(eventSlug)}/link`;
  const polling = useRef(false);

  useEffect(() => {
    if (!shown || (status !== "pending" && status !== "active")) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (polling.current) return;
      polling.current = true;
      request(path)
        .then((response) => { if (response?.data?.status) setStatus(response.data.status as Status); })
        .catch(() => {})
        .finally(() => { polling.current = false; });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [shown, status, path, request]);

  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await request(path, { method: "POST", body: "{}" });
      setShown({ code: response.data.code, expiresAt: response.data.expiresAt, qrSvg: response.data.qrSvg });
      setStatus("pending");
      setNow(Date.now());
    } catch {
      setError("تعذر إنشاء الرمز الحين. حاول مرة ثانية.");
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      await request(path, { method: "DELETE" });
      setStatus("revoked");
      setShown(null);
    } catch {
      setError("تعذر إيقاف الربط. حاول مرة ثانية.");
    } finally {
      setBusy(false);
    }
  };

  const left = shown ? Math.max(0, Math.round((Date.parse(shown.expiresAt) - now) / 1000)) : 0;
  const expired = status === "expired" || (status === "pending" && left === 0);
  return (
    <section aria-labelledby="me-link">
      <h2 id="me-link">اعرض مسارك على شاشة</h2>
      {status === "active" ? (
        <>
          <p role="status">الشاشة تعرض مسارك الحين، للقراءة فقط. توقف لحالها إذا تركتها دقيقة.</p>
          <button type="button" className="cta secondary" disabled={busy} onClick={() => void stop()}>أوقف الربط</button>
        </>
      ) : shown && !expired && status === "pending" ? (
        <div className="link-code">
          <p>اكتب الرمز في شاشة ونيس أو صوّر الـQR. يشتغل مرة وحدة.</p>
          <output className="link-code-value" aria-label={`الرمز ${shown.code.split("").join(" ")}`} dir="ltr">{shown.code.slice(0, 3)} {shown.code.slice(3)}</output>
          <img className="link-code-qr" src={`data:image/svg+xml;utf8,${encodeURIComponent(shown.qrSvg)}`} alt="رمز QR لربط الشاشة" width={160} height={160} />
          <p className="visitor-note" aria-live="polite">{left > 60 ? `ينتهي بعد ${Math.ceil(left / 60)} دقائق` : `ينتهي بعد ${left} ثانية`}</p>
          <button type="button" className="cta secondary" disabled={busy} onClick={() => void stop()}>ألغِ الرمز</button>
        </div>
      ) : (
        <>
          <p>{status === "idle" || status === "revoked" ? "انتهى الربط مع الشاشة." : expired ? "انتهى الرمز قبل ما يُستخدم." : "شاشات ونيس في الموقع تقدر تعرض مسارك بخط كبير، بدون ما تعطيها جوالك."}</p>
          <button type="button" className="cta secondary" disabled={busy} onClick={() => void create()}>{busy ? "لحظة…" : "اربط بشاشة"}</button>
        </>
      )}
      {error && <p className="guide" role="alert">{error}</p>}
    </section>
  );
}
