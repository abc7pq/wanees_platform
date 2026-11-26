"use client";
import { useState } from "react";
import { BrandLogo } from "../brand";
import { PasswordField } from "../../lib/password-field";
import { MIN_PASSWORD_LENGTH } from "../../lib/password-policy";

export type DemoCredentials = { email: string; password: string; scope: "local" | "public" };

export default function LoginForm({ demo }: { demo?: DemoCredentials }) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [needsNewPassword, setNeedsNewPassword] = useState(false);

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
          {needsNewPassword && <fieldset className="new-password">
            <legend>اختر كلمة مرور جديدة</legend>
            <p className="hint" id="new-password-hint">كلمة المرور المؤقتة تُستخدم مرة واحدة فقط. اختر {MIN_PASSWORD_LENGTH} حرفًا على الأقل، ولا تستخدم بريدك داخلها.</p>
            <label htmlFor="admin-new-password">كلمة المرور الجديدة</label>
            <input id="admin-new-password" name="newPassword" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH}
              aria-describedby="new-password-hint" disabled={busy} onChange={() => setErr("")} />
            <label htmlFor="admin-new-password-confirm">أعد كتابة كلمة المرور الجديدة</label>
            <input id="admin-new-password-confirm" name="newPasswordConfirm" type="password" autoComplete="new-password" required
              disabled={busy} onChange={() => setErr("")} />
          </fieldset>}
          {err && <p className="err" role="alert">{err}</p>}
          <button type="submit" className="btn primary" disabled={busy}>{busy ? "جارٍ تسجيل الدخول…" : needsNewPassword ? "احفظ كلمة المرور وادخل" : "دخول"}</button>
        </form>
      </div>
      {demo && <aside className="demo-credentials" aria-labelledby="demo-credentials-title">
        <h3 id="demo-credentials-title">{demo.scope === "local" ? "حساب العرض المحلي" : "حساب التجربة"}</h3>
        <p>{demo.scope === "local" ? "صلاحية مدير تجريبي." : "حساب تجريبي لاستكشاف لوحة الإدارة."} استخدم البيانات التالية في نموذج الدخول.</p>
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
    const newPassword = needsNewPassword ? String(form.get("newPassword") ?? "") : "";
    if (needsNewPassword && newPassword !== String(form.get("newPasswordConfirm") ?? "")) {
      setErr("كلمتا المرور الجديدتان غير متطابقتين.");
      return;
    }
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newPassword ? { email, password, newPassword } : { email, password }) });
      if (res.ok) location.href = safeNextPath(new URLSearchParams(location.search).get("next"));
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
    const d = await res.json().catch(() => ({} as { error?: string; code?: string }));
    if (d.code === "PASSWORD_CHANGE_REQUIRED") {
      setNeedsNewPassword(true);
      setErr(d.error ?? "اختر كلمة مرور جديدة لإكمال تفعيل حسابك.");
      requestAnimationFrame(() => document.getElementById("admin-new-password")?.focus());
    }
    else if (d.code === "PASSWORD_REJECTED") setErr(d.error ?? "كلمة المرور الجديدة غير مقبولة.");
    else if (res.status === 429) setErr(d.error ?? "محاولات كثيرة");
    else if (res.status >= 500) setErr("الخدمة غير متاحة مؤقتًا — حاول مرة أخرى بعد قليل");
    else setErr("كلمة المرور غير صحيحة");
  }
}

// Only same-site absolute paths are accepted, so ?next= cannot redirect off-site.
function safeNextPath(next: string | null) {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || next.startsWith("/login")) return "/";
  return next;
}
