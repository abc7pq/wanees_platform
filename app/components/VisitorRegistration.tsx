"use client";
import { useEffect, useId, useRef, useState } from "react";
import { VISITOR_CONSENT_VERSION, type VisitorProfileSummary } from "../../packages/contracts/src/index.ts";
import styles from "./visitor-registration.module.css";
import { AR_ATTEMPT, AR_MINUTE, arCount } from "@/lib/ar-count";

type Props = {
  eventSlug: string;
  onRegistered: (visitor: VisitorProfileSummary) => void;
};

type ApiError = { code?: string; message?: string; details?: { attemptsLeft?: number } };

export const VISITOR_CONSENT_TEXT =
  "نحفظ اسمك ورقم جوالك وزياراتك وتقييماتك عند منظّم الفعالية، حتى يتذكرك ونيس في زيارتك الجاية. نحتفظ بها سنة من آخر زيارة، وتقدر تحذفها متى ما تبي من «احذف بياناتي». ما نرسل اسمك أو رقمك لنموذج الذكاء الاصطناعي.";

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body) });
  const payload = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data: payload?.data, error: (payload?.error ?? {}) as ApiError, retryAfter: Number(res.headers.get("retry-after") ?? 0) };
}

/** Name + Saudi mobile + consent, then a 6-digit SMS code. Arabic RTL; the phone and code fields are LTR. */
export function VisitorRegistration({ eventSlug, onRegistered }: Props) {
  const ids = useId();
  const [stage, setStage] = useState<"details" | "code">("details");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [maskedPhone, setMaskedPhone] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  useEffect(() => {
    if (stage === "code") codeInput.current?.focus();
  }, [stage]);

  function describe(status: number, apiError: ApiError, retryAfter: number) {
    if (typeof navigator !== "undefined" && !navigator.onLine) return "ما فيه اتصال. تأكد من الإنترنت وحاول مرة ثانية.";
    if (status === 429 && retryAfter > 0) return `${apiError.message ?? "محاولات كثيرة."} (بعد ${arCount(Math.ceil(retryAfter / 60), AR_MINUTE)} تقريبًا)`;
    if (apiError.code === "OTP_CODE_INVALID" && typeof apiError.details?.attemptsLeft === "number") {
      return `${apiError.message} باقي ${arCount(apiError.details.attemptsLeft, AR_ATTEMPT)}.`;
    }
    return apiError.message ?? "صار خطأ. حاول مرة ثانية.";
  }

  async function sendCode() {
    if (busy) return;
    setError("");
    if (!consent) { setError("وافق على حفظ بياناتك أولًا."); return; }
    setBusy(true);
    try {
      const result = await post(`/api/v1/events/${encodeURIComponent(eventSlug)}/visitor/otp/start`, {
        name, phone, consent: true, consentVersion: VISITOR_CONSENT_VERSION, clientType: "web",
      });
      if (!result.ok) { setError(describe(result.status, result.error, result.retryAfter)); return; }
      setChallengeId(result.data.challengeId);
      setMaskedPhone(result.data.maskedPhone);
      setResendIn(result.data.resendAfterSeconds ?? 60);
      setCode("");
      setStage("code");
    } catch {
      setError("ما فيه اتصال. تأكد من الإنترنت وحاول مرة ثانية.");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (busy || code.trim().length < 4) return;
    setError("");
    setBusy(true);
    try {
      const result = await post(`/api/v1/events/${encodeURIComponent(eventSlug)}/visitor/otp/verify`, { challengeId, code: code.trim(), rememberDevice: true, clientType: "web" });
      if (!result.ok) {
        setError(describe(result.status, result.error, result.retryAfter));
        if (["OTP_CHALLENGE_EXPIRED", "OTP_CHALLENGE_NOT_FOUND", "OTP_TOO_MANY_ATTEMPTS"].includes(result.error.code ?? "")) setCode("");
        return;
      }
      onRegistered(result.data.visitor as VisitorProfileSummary);
    } catch {
      setError("ما فيه اتصال. تأكد من الإنترنت وحاول مرة ثانية.");
    } finally {
      setBusy(false);
    }
  }

  if (stage === "code") {
    return (
      <form className={styles.card} aria-busy={busy} onSubmit={(event) => { event.preventDefault(); void verify(); }}>
        <h2 className={styles.title}>اكتب رمز التحقق</h2>
        <p className={styles.hint}>أرسلنا رمز من ٦ أرقام إلى <bdi dir="ltr">{maskedPhone}</bdi></p>
        <label htmlFor={`${ids}-code`} className={styles.label}>الرمز</label>
        <input
          ref={codeInput}
          id={`${ids}-code`}
          className={`${styles.input} ${styles.code}`}
          dir="ltr"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={8}
          value={code}
          disabled={busy}
          onChange={(event) => { setCode(event.target.value.replace(/[^0-9٠-٩۰-۹]/g, "")); setError(""); }}
        />
        {error && <p className={styles.error} role="alert">{error}</p>}
        <button type="submit" className="cta" disabled={busy || code.trim().length < 4}>{busy ? "جارٍ التحقق…" : "تأكيد"}</button>
        <div className={styles.row}>
          <button type="button" className="ghost-link" disabled={busy || resendIn > 0} onClick={() => void sendCode()}>
            {resendIn > 0 ? `إعادة الإرسال بعد ${resendIn} ث` : "أعد إرسال الرمز"}
          </button>
          <button type="button" className="ghost-link" disabled={busy} onClick={() => { setStage("details"); setError(""); }}>تغيير الرقم</button>
        </div>
      </form>
    );
  }

  return (
    <form className={styles.card} aria-busy={busy} onSubmit={(event) => { event.preventDefault(); void sendCode(); }}>
      <h2 className={styles.title}>قبل نبدأ، عرّفنا عليك</h2>
      <label htmlFor={`${ids}-name`} className={styles.label}>الاسم</label>
      <input id={`${ids}-name`} className={styles.input} autoComplete="name" maxLength={60} required value={name} disabled={busy}
        onChange={(event) => { setName(event.target.value); setError(""); }} />
      <label htmlFor={`${ids}-phone`} className={styles.label}>رقم الجوال</label>
      <input id={`${ids}-phone`} className={styles.input} dir="ltr" type="tel" inputMode="tel" autoComplete="tel" placeholder="05xxxxxxxx"
        maxLength={20} required value={phone} disabled={busy} onChange={(event) => { setPhone(event.target.value); setError(""); }} />
      <label className={styles.consent}>
        <input type="checkbox" checked={consent} disabled={busy} onChange={(event) => { setConsent(event.target.checked); setError(""); }} />
        <span>{VISITOR_CONSENT_TEXT}</span>
      </label>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <button type="submit" className="cta" disabled={busy || !consent || !name.trim() || !phone.trim()}>{busy ? "جارٍ الإرسال…" : "أرسل الرمز"}</button>
    </form>
  );
}
