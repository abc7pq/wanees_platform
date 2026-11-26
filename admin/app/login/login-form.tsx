"use client";
import { useState } from "react";
import { BrandLogo } from "../brand";
import { PasswordField } from "../../lib/password-field";

export default function LoginForm({ demo }: { demo?: { email: string; password: string } }) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");

  return (
    <main className="wrap center login-page">
      <div className="login">
        <BrandLogo height={70} wordmark label="ونيس" priority className="login-logo" />
        <h1>لوحة الإدارة</h1>
        <p className="sub">سجّل الدخول لإدارة الفعاليات</p>
        <form aria-busy={busy} onSubmit={(event) => { event.preventDefault(); void submit(new FormData(event.currentTarget)); }}>
          <label htmlFor="admin-email">البريد الإلكتروني (اختياري)</label>
          <input id="admin-email" name="email" type="email" dir="ltr" disabled={busy} autoComplete="username"
            onChange={() => setErr("")} />
          <PasswordField disabled={busy} onChange={() => setErr("")} />
          {err && <p className="err" role="alert">{err}</p>}
          <button type="submit" className="btn primary" disabled={busy}>{busy ? "جارٍ تسجيل الدخول…" : "دخول"}</button>
        </form>
      </div>
      {demo && <aside className="demo-credentials" aria-labelledby="demo-credentials-title">
        <h3 id="demo-credentials-title">حساب العرض المحلي</h3>
        <p>صلاحية مدير تجريبي. استخدم البيانات التالية في نموذج الدخول.</p>
        <dl>
          {[
            { label: "البريد الإلكتروني", value: demo.email },
            { label: "كلمة المرور", value: demo.password },
          ].map(({ label, value }) => <div key={label}>
            <dt>{label}</dt>
            <dd>
              <code dir="ltr">{value}</code>
              <button type="button" className="btn" aria-label={`نسخ ${label}`} onClick={() => copyCredential(label, value)}>نسخ</button>
            </dd>
          </div>)}
        </dl>
        <div className="demo-copy-status" role="status">{copyStatus}</div>
      </aside>}
    </main>
  );

  async function submit(form: FormData) {
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    if (busy || !password) return;
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      if (res.ok) location.href = "/";
      else await setMsg401(res);
    } catch { setErr("تعذر الاتصال بالخادم"); }
    finally { setBusy(false); }
  }

  async function copyCredential(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus(`تم نسخ ${label}`);
    } catch {
      setCopyStatus("تعذر النسخ تلقائيًا. حدّد النص لنسخه.");
    }
  }

  async function setMsg401(res: Response) {
    const d = await res.json().catch(() => ({} as { error?: string }));
    setErr(res.status === 429 ? (d.error ?? "محاولات كثيرة") : "كلمة المرور غير صحيحة");
  }
}
