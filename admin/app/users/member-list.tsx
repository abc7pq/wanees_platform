"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Topbar } from "../dashboard";
import { adminFetch } from "@/lib/admin-fetch";
import { memberRoleLabel, userStatusLabel } from "@/lib/arabic-labels";

type Member = {
  userId: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
  joinedAt: string;
  isSelf: boolean;
  otherOrganizations: number;
};

type Payload = {
  organization: { slug: string; name: string } | null;
  viewer: { userId: string; role: string };
  assignableRoles: string[];
  members: Member[];
};

type OrgChoice = { slug: string; name: string };

const dateFormat = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { dateStyle: "medium", timeZone: "Asia/Riyadh" });

async function errorMessage(res: Response, fallback: string) {
  const payload = await res.json().catch(() => null);
  return payload?.error?.message ?? fallback;
}

// The page cannot name its own entry in the shared topbar yet, so none is marked current there.

export default function MemberList() {
  const [organizations, setOrganizations] = useState<OrgChoice[]>([]);
  const [organization, setOrganization] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "forbidden">("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");
  const [form, setForm] = useState({ email: "", displayName: "", role: "VIEWER" });
  const [adding, setAdding] = useState(false);
  const [issued, setIssued] = useState<{ email: string; password: string } | null>(null);

  const query = organization ? `?organization=${encodeURIComponent(organization)}` : "";

  useEffect(() => {
    void adminFetch("/api/v1/me", { credentials: "include" })
      .then(async (res) => (res.ok ? (await res.json()).data : null))
      .then((me) => {
        if (!me) return;
        const choices = (me.memberships as { organization: OrgChoice; permissions: { manageMembers: boolean } }[])
          .filter((membership) => membership.permissions.manageMembers)
          .map((membership) => membership.organization);
        setOrganizations(choices);
      })
      .catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setState("loading");
    setError("");
    try {
      const res = await adminFetch(`/api/v1/users${query}`, { credentials: "include" });
      if (res.status === 401) return;
      if (res.status === 403) { setState("forbidden"); return; }
      if (!res.ok) throw new Error(await errorMessage(res, `HTTP ${res.status}`));
      setData((await res.json()).data);
      setState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تحميل المستخدمين.");
      setState("error");
    }
  }, [query]);

  useEffect(() => { void load(); }, [load]);

  async function addMember(event: FormEvent) {
    event.preventDefault();
    setAdding(true);
    setError("");
    setNotice("");
    setIssued(null);
    try {
      const res = await adminFetch(`/api/v1/users${query}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(await errorMessage(res, "تعذر إضافة العضو."));
      const payload = (await res.json()).data as { member: Member; temporaryPassword: string | null; existingAccount: boolean };
      if (payload.temporaryPassword) setIssued({ email: payload.member.email, password: payload.temporaryPassword });
      else setNotice(`أُضيف «${payload.member.displayName}» بحسابه الحالي؛ يدخل بكلمة مروره المعتادة.`);
      setForm({ email: "", displayName: "", role: "VIEWER" });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر إضافة العضو.");
    } finally {
      setAdding(false);
    }
  }

  async function patchMember(member: Member, body: { role: string } | { status: string }, success: string) {
    setBusyId(member.userId);
    setError("");
    setNotice("");
    try {
      const res = await adminFetch(`/api/v1/users/${encodeURIComponent(member.userId)}${query}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await errorMessage(res, "تعذر حفظ التغيير."));
      setNotice(success);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر حفظ التغيير.");
      await load();
    } finally {
      setBusyId("");
    }
  }

  async function removeMember(member: Member) {
    if (!window.confirm(`إزالة «${member.displayName}» من الجهة وتسجيل خروجه من كل الأجهزة؟`)) return;
    setBusyId(member.userId);
    setError("");
    setNotice("");
    try {
      const res = await adminFetch(`/api/v1/users/${encodeURIComponent(member.userId)}${query}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error(await errorMessage(res, "تعذر إزالة العضو."));
      setNotice(`أُزيل «${member.displayName}» من الجهة.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر إزالة العضو.");
    } finally {
      setBusyId("");
    }
  }

  const viewerRole = data?.viewer.role ?? "";
  const canTouch = (member: Member) => !(member.role === "OWNER" && viewerRole !== "OWNER");

  return (
    <div className="wrap">
      <Topbar current="users" />
      <main id="main-content" className="main-content" tabIndex={-1}>
        <div className="card" aria-busy={state === "loading"}>
          <header className="workspace-heading">
            <div>
              <h1>المستخدمون</h1>
              <p style={{ fontSize: 13 }}>أعضاء {data?.organization ? <bdi>{data.organization.name}</bdi> : "الجهة"} وأدوارهم. كل إضافة وتغيير وإزالة تُسجَّل في سجل التدقيق.</p>
            </div>
            {organizations.length > 1 && (
              <div>
                <label htmlFor="member-organization" className="sr-only">الجهة</label>
                <select id="member-organization" value={organization || data?.organization?.slug || ""} onChange={(event) => setOrganization(event.target.value)}>
                  {organizations.map((choice) => <option key={choice.slug} value={choice.slug}>{choice.name}</option>)}
                </select>
              </div>
            )}
          </header>

          {state === "forbidden" && <p className="err" role="alert">إدارة المستخدمين متاحة للمالك والمدير فقط.</p>}
          {state === "loading" && <p style={{ color: "var(--dim)" }}>جارٍ التحميل…</p>}
          {error && <p className="err" role="alert">{error} {state === "error" && <button type="button" className="btn small ghost" onClick={() => void load()}>إعادة المحاولة</button>}</p>}
          {notice && <p role="status" style={{ color: "var(--teal)", fontSize: 13 }}>{notice}</p>}

          {issued && (
            <section role="alert" className="card" style={{ margin: "12px 0", borderColor: "var(--violet)" }} aria-labelledby="issued-title">
              <h2 id="issued-title">كلمة المرور المؤقتة</h2>
              <p style={{ fontSize: 13 }}>انسخها الآن وسلّمها لصاحب الحساب بطريقة آمنة؛ لن تظهر مرة أخرى. عند أول دخول يختار صاحب الحساب كلمة مرور جديدة، ولا تفتح المؤقتة أي جلسة.</p>
              <p><span className="mono" dir="ltr">{issued.email}</span></p>
              <p><output className="mono" dir="ltr" style={{ fontSize: 18, letterSpacing: 1 }}>{issued.password}</output></p>
              <div className="row">
                <button type="button" className="btn small" onClick={() => void navigator.clipboard?.writeText(issued.password).then(() => setNotice("نُسخت كلمة المرور.")).catch(() => undefined)}>نسخ</button>
                <button type="button" className="btn small ghost" onClick={() => setIssued(null)}>تم، أخفها</button>
              </div>
            </section>
          )}

          {state === "ready" && data && data.members.length === 0 && <p style={{ color: "var(--dim)" }}>ما فيه أعضاء في هذه الجهة بعد.</p>}

          {state === "ready" && data && data.members.length > 0 && (
            <table className="responsive-table">
              <caption className="sr-only">أعضاء الجهة</caption>
              <thead>
                <tr><th scope="col">العضو</th><th scope="col">الدور</th><th scope="col">الحالة</th><th scope="col">منذ</th><th scope="col">الإجراء</th></tr>
              </thead>
              <tbody>
                {data.members.map((member) => {
                  const editable = canTouch(member);
                  const busy = busyId === member.userId;
                  const roleOptions = editable ? [...new Set([member.role, ...data.assignableRoles])] : [member.role];
                  return (
                    <tr key={member.userId}>
                      <td><span className="cell-label" aria-hidden="true">العضو</span><div className="cell-value"><strong><bdi>{member.displayName}</bdi></strong>{member.isSelf && <span className="badge" style={{ marginInlineStart: 6 }}>أنت</span>}<div className="mono" dir="ltr">{member.email}</div></div></td>
                      <td>
                        <span className="cell-label" aria-hidden="true">الدور</span>
                        <div className="cell-value">
                          <label htmlFor={`role-${member.userId}`} className="sr-only">دور {member.displayName}</label>
                          <select id={`role-${member.userId}`} value={member.role} disabled={!editable || busy}
                            onChange={(event) => void patchMember(member, { role: event.target.value }, `صار «${member.displayName}» ${memberRoleLabel(event.target.value)}.`)}>
                            {roleOptions.map((role) => <option key={role} value={role}>{memberRoleLabel(role)}</option>)}
                          </select>
                        </div>
                      </td>
                      <td><span className="cell-label" aria-hidden="true">الحالة</span><div className="cell-value"><span className={`badge${member.status === "ACTIVE" ? " on" : ""}`}>{userStatusLabel(member.status)}</span></div></td>
                      <td><span className="cell-label" aria-hidden="true">منذ</span><div className="cell-value">{dateFormat.format(new Date(member.joinedAt))}</div></td>
                      <td className="actions-cell">
                        <span className="cell-label" aria-hidden="true">الإجراء</span>
                        <div className="cell-value row">
                          {editable && !member.isSelf && member.otherOrganizations === 0 && member.status !== "DISABLED" && (
                            <button type="button" className="btn small ghost" disabled={busy} onClick={() => void patchMember(member, { status: "DISABLED" }, `عُطّل حساب «${member.displayName}» وسُجّل خروجه.`)} aria-label={`تعطيل ${member.displayName}`}>تعطيل</button>
                          )}
                          {editable && member.otherOrganizations === 0 && member.status === "DISABLED" && (
                            <button type="button" className="btn small ghost" disabled={busy} onClick={() => void patchMember(member, { status: "ACTIVE" }, `فُعّل حساب «${member.displayName}».`)} aria-label={`تفعيل ${member.displayName}`}>تفعيل</button>
                          )}
                          {editable && !member.isSelf && (
                            <button type="button" className="btn small danger" disabled={busy} onClick={() => void removeMember(member)} aria-label={`إزالة ${member.displayName}`}>إزالة</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {state === "ready" && data && data.assignableRoles.length > 0 && (
          <section className="card" style={{ marginTop: 16 }} aria-labelledby="add-member-title">
            <h2 id="add-member-title">إضافة عضو</h2>
            <form onSubmit={addMember} className="grid2">
              <div>
                <label htmlFor="member-email">البريد الإلكتروني</label>
                <input id="member-email" type="email" dir="ltr" required maxLength={254} autoComplete="off" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} style={{ width: "100%" }} />
              </div>
              <div>
                <label htmlFor="member-name">الاسم الظاهر</label>
                <input id="member-name" type="text" required minLength={2} maxLength={80} autoComplete="off" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} style={{ width: "100%" }} />
              </div>
              <div>
                <label htmlFor="member-role">الدور</label>
                <select id="member-role" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })} style={{ width: "100%" }}>
                  {data.assignableRoles.map((role) => <option key={role} value={role}>{memberRoleLabel(role)}</option>)}
                </select>
              </div>
              <div style={{ alignSelf: "end" }}>
                <button type="submit" className="btn primary" disabled={adding} style={{ width: "100%" }}>{adding ? "جارٍ الإضافة…" : "إضافة"}</button>
              </div>
            </form>
            <p style={{ color: "var(--dim)", fontSize: 12.5, marginTop: 8 }}>يُنشأ حساب جديد بكلمة مرور مؤقتة تظهر مرة واحدة. منح دور المالك للمالك فقط.</p>
          </section>
        )}
      </main>
    </div>
  );
}
