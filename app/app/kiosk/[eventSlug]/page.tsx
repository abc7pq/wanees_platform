"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { KIOSK_IDLE_SECONDS } from "../../../../packages/contracts/src/index.ts";
import { minutesCount } from "@/lib/ar-count";

// A plain kiosk test page (audit 5.2). The screen signs in with its device token (#kiosk=… once, kept on
// this device), starts an anonymous visit, and forgets everything after a minute idle or «انتهيت».
// Every walking answer counts from the kiosk's own node; the server decides that, not this page.

type Reply = { message: string; sources: Array<{ id?: string; name?: string; zoneName?: string }>; walkMin: number | null; linked: boolean };
type LinkedStop = { activityId: string; name: string; zoneName: string; startsAt: string };

const STORAGE_KEY = (slug: string) => `wanees.kiosk.${slug}`;
const QUICK = ["وين أقرب دورة مياه؟", "وش العروض الجاية؟", "أبي مطعم قريب", "وين أقرب مصلى؟"];

function readStored(slug: string) {
  try { return window.localStorage.getItem(STORAGE_KEY(slug)); } catch { return null; }
}
function store(slug: string, token: string) {
  try { window.localStorage.setItem(STORAGE_KEY(slug), token); } catch { /* the page still works for this load */ }
}
function timeText(iso: string) {
  return new Intl.DateTimeFormat("ar-SA-u-nu-latn", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" }).format(new Date(iso));
}

export default function KioskPage({ params }: { params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = use(params);
  const [kioskToken, setKioskToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<Reply | null>(null);
  const [error, setError] = useState("");
  const [language, setLanguage] = useState<"ar" | "en">("ar");
  const [code, setCode] = useState("");
  const [grantId, setGrantId] = useState<string | null>(null);
  const [linkedStops, setLinkedStops] = useState<LinkedStop[] | null>(null);
  const sessionToken = useRef<string | null>(null);
  const idleTimer = useRef<number | null>(null);
  const base = `/api/v1/events/${encodeURIComponent(eventSlug)}`;

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const fromHash = hash.get("kiosk");
    if (fromHash) store(eventSlug, fromHash);
    if (hash.get("code")) setCode(hash.get("code") ?? "");
    // The device token never stays in the address bar.
    if (fromHash || hash.get("code")) window.history.replaceState(null, "", window.location.pathname);
    setKioskToken(fromHash ?? readStored(eventSlug));
    setReady(true);
  }, [eventSlug]);

  const reset = useCallback(async () => {
    const token = sessionToken.current;
    if (token && grantId) {
      await fetch(`${base}/link/${encodeURIComponent(grantId)}`, { method: "DELETE", headers: { "x-wanees-session-token": token } }).catch(() => {});
    }
    sessionToken.current = null;
    setReply(null); setQuestion(""); setError(""); setCode(""); setGrantId(null); setLinkedStops(null); setLanguage("ar");
  }, [base, grantId]);

  // A minute without a touch: the next person starts fresh (the server also ends the visit).
  const touch = useCallback(() => {
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => { void reset(); }, KIOSK_IDLE_SECONDS * 1000);
  }, [reset]);
  useEffect(() => () => { if (idleTimer.current) window.clearTimeout(idleTimer.current); }, []);

  const call = async (path: string, init: RequestInit = {}, retried = false): Promise<any> => {
    if (!sessionToken.current) {
      const started = await fetch(`${base}/session`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-wanees-kiosk-token": kioskToken ?? "" },
        body: JSON.stringify({ clientType: "kiosk", locale: "ar-SA", entryPoint: "kiosk" }),
      });
      const body = await started.json().catch(() => null);
      if (!started.ok) throw new Error(body?.error?.code ?? "SESSION_FAILED");
      sessionToken.current = body.data.token;
    }
    const response = await fetch(`${base}${path}`, { ...init, headers: { "content-type": "application/json", "x-wanees-session-token": sessionToken.current ?? "", ...(init.headers ?? {}) } });
    const body = await response.json().catch(() => null);
    if (response.status === 404 && body?.error?.code === "SESSION_NOT_FOUND" && !retried) {
      sessionToken.current = null;
      return call(path, init, true);
    }
    if (!response.ok) throw Object.assign(new Error(body?.error?.code ?? `HTTP_${response.status}`), { status: response.status });
    return body;
  };

  const ask = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    touch();
    setBusy(true); setError("");
    try {
      const body = await call("/assistant", { method: "POST", body: JSON.stringify({ message, channel: "text", language, ...(grantId ? { linkGrantId: grantId } : {}) }) });
      const data = body.data;
      setReply({ message: data.message, sources: Array.isArray(data.sources) ? data.sources.slice(0, 3) : [], walkMin: data.directions?.totalWalkMin ?? null, linked: Boolean(data.linked) });
      setQuestion("");
    } catch (failure) {
      if ((failure as Error).message === "LINK_ENDED") { setGrantId(null); setLinkedStops(null); setError("انتهى الربط مع جوالك. اطلب رمز جديد."); }
      else if ((failure as Error).message === "KIOSK_TOKEN_INVALID") setError("هذي الشاشة موقوفة. كلّم فريق التشغيل.");
      else setError("ما قدرت أجاوب الحين. جرّب مرة ثانية.");
    } finally {
      setBusy(false);
    }
  };

  const link = async () => {
    touch();
    setBusy(true); setError("");
    try {
      const redeemed = await call("/link/redeem", { method: "POST", body: JSON.stringify({ code }) });
      const id = redeemed.data.grantId as string;
      const view = await call(`/link/${encodeURIComponent(id)}`);
      setGrantId(id);
      setLinkedStops(view.data.stops);
      setCode("");
    } catch {
      setError("الرمز غير صحيح أو انتهى. اطلب رمز جديد من «أنا» في جوالك.");
    } finally {
      setBusy(false);
    }
  };

  if (!ready) return <main className="kiosk" dir="rtl" />;
  if (!kioskToken) {
    return (
      <main className="kiosk" dir="rtl">
        <h1>شاشة ونيس</h1>
        <p>هذي الصفحة لشاشات ونيس في موقع الفعالية. افتح ونيس من جوالك بدلًا منها.</p>
        <a className="kiosk-big" href={`/e/${encodeURIComponent(eventSlug)}`}>افتح ونيس</a>
      </main>
    );
  }
  return (
    <main className="kiosk" dir="rtl" onPointerDown={touch} onKeyDown={touch}>
      <header className="kiosk-head">
        <h1>اسأل ونيس</h1>
        <div className="kiosk-lang" role="radiogroup" aria-label="لغة الرد">
          <button type="button" role="radio" aria-checked={language === "ar"} onClick={() => setLanguage("ar")}>العربية</button>
          <button type="button" role="radio" aria-checked={language === "en"} onClick={() => setLanguage("en")}>English</button>
        </div>
      </header>
      <div className="kiosk-grid">
        <section aria-labelledby="kiosk-ask">
          <h2 id="kiosk-ask" className="sr-only">سؤالك</h2>
          <form onSubmit={(event) => { event.preventDefault(); void ask(question); }}>
            <label htmlFor="kiosk-question" className="sr-only">اكتب سؤالك</label>
            <input id="kiosk-question" dir="auto" value={question} maxLength={300} placeholder="مثلًا: وين أقرب دورة مياه؟" onChange={(event) => setQuestion(event.target.value)} />
            <button type="submit" className="kiosk-big" disabled={busy || !question.trim()}>{busy ? "لحظة…" : "اسأل"}</button>
          </form>
          <div className="kiosk-quick" role="group" aria-label="أسئلة سريعة">
            {QUICK.map((item) => <button key={item} type="button" disabled={busy} onClick={() => void ask(item)}>{item}</button>)}
          </div>
          <div aria-live="polite">
            {reply && (
              <article className="kiosk-reply">
                <p>{reply.message}</p>
                {reply.walkMin != null && <p className="kiosk-note">🚶 {minutesCount(reply.walkMin)} مشي من هالشاشة</p>}
                {reply.sources.length > 0 && (
                  <ul>{reply.sources.map((source, index) => <li key={`${source.id ?? index}`}>{source.name}{source.zoneName ? ` · ${source.zoneName}` : ""}</li>)}</ul>
                )}
              </article>
            )}
            {error && <p role="alert" className="kiosk-error">{error}</p>}
          </div>
        </section>
        <section aria-labelledby="kiosk-link">
          <h2 id="kiosk-link">مسارك من جوالك</h2>
          {linkedStops ? (
            <>
              {linkedStops.length
                ? <ol className="kiosk-stops">{linkedStops.map((stop) => <li key={stop.activityId}><b>{stop.name}</b> <span>{timeText(stop.startsAt)} · {stop.zoneName}</span></li>)}</ol>
                : <p>ما فيه مسار في جوالك للحين.</p>}
              <p className="kiosk-note">للقراءة فقط. التعديل من جوالك.</p>
            </>
          ) : (
            <form onSubmit={(event) => { event.preventDefault(); void link(); }}>
              <p>من «أنا» في جوالك اختر «اربط بشاشة» واكتب الرمز هنا.</p>
              <label htmlFor="kiosk-code" className="sr-only">رمز الربط</label>
              <input id="kiosk-code" dir="ltr" inputMode="text" autoCapitalize="characters" autoComplete="off" value={code} maxLength={9} placeholder="ABC 234" onChange={(event) => setCode(event.target.value)} />
              <button type="submit" className="kiosk-big" disabled={busy || code.replace(/\s|-/g, "").length !== 6}>اربط</button>
            </form>
          )}
        </section>
      </div>
      <footer className="kiosk-foot">
        <button type="button" className="kiosk-big kiosk-done" onClick={() => void reset()}>انتهيت</button>
        <p className="kiosk-note">ما نحفظ شي بعد ما تمشي. الشاشة تنسى كل شي بعد دقيقة.</p>
      </footer>
    </main>
  );
}
