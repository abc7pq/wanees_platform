"use client";

import { useEffect, useRef, useState } from "react";
import { eventStatusLabel } from "@/lib/arabic-labels";
import { nextEventActions, VISITOR_VISIBLE_STATUSES, type EventStatus, type NextAction } from "@/lib/event-lifecycle";

const STATUS_TONE: Record<string, string> = { PUBLISHED: " on", LIVE: " on live", COMPLETED: " done", ARCHIVED: " archived" };

export function EventStatusBadge({ status }: { status: string }) {
  return <span className={`badge${STATUS_TONE[status] ?? ""}`}>{eventStatusLabel(status)}</span>;
}

const CONFIRM_TEXT: Partial<Record<EventStatus, string>> = {
  ARCHIVED: "ستختفي الفعالية عن الزوار وتنتقل إلى قسم الأرشيف. تبقى بياناتها ويمكن استعادتها كمسودة لاحقًا.",
  COMPLETED: "ستتوقف واجهة الزائر لهذه الفعالية فورًا. لا يمكن إعادتها مباشرة بعد الإنهاء.",
};

/**
 * Next lifecycle steps for one event. Archive and finish ask for a second, explicit click;
 * the API refuses them without `confirm: true` as well (admin/lib/event-lifecycle.ts).
 */
export function EventStatusControls({ slug, name, status, hasPublishedCatalog, onChanged }: {
  slug: string;
  name: string;
  status: string;
  hasPublishedCatalog: boolean;
  onChanged: (status: EventStatus) => void;
}) {
  const [pending, setPending] = useState<NextAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const confirmRef = useRef<HTMLButtonElement>(null);
  const actions = nextEventActions(status, { hasPublishedCatalog });

  useEffect(() => { if (pending) confirmRef.current?.focus(); }, [pending]);

  async function apply(action: NextAction) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/v1/events/${encodeURIComponent(slug)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Idempotency-Key": `event-status-${slug}-${status}-${action.to}-${Date.now()}` },
        body: JSON.stringify({ from: status, to: action.to, confirm: action.requiresConfirmation }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(payload.error?.message ?? "تعذر تغيير حالة الفعالية.");
        return;
      }
      setPending(null);
      onChanged(action.to);
    } catch {
      setMessage("تعذر الاتصال. تحقق من حالة الفعالية بعد تحديث الصفحة قبل إعادة المحاولة.");
    } finally {
      setBusy(false);
    }
  }

  if (!actions.length) return null;
  const visible = VISITOR_VISIBLE_STATUSES.includes(status as EventStatus);
  return (
    <div className="lifecycle" aria-busy={busy}>
      <small>{visible ? "ظاهرة للزوار الآن." : "غير ظاهرة للزوار."}</small>
      {!pending && <div className="row lifecycle-actions" role="group" aria-label={`تغيير حالة ${name}`}>
        {actions.map((action) => (
          <button
            key={action.to}
            type="button"
            className={`btn small${action.to === "ARCHIVED" || action.to === "COMPLETED" ? " ghost danger" : " ghost"}`}
            disabled={busy || Boolean(action.blockedReason)}
            title={action.blockedReason ?? undefined}
            aria-describedby={action.blockedReason ? `blocked-${slug}-${action.to}` : undefined}
            onClick={() => (action.requiresConfirmation ? setPending(action) : void apply(action))}
          >{action.label}</button>
        ))}
      </div>}
      {!pending && actions.filter((action) => action.blockedReason).map((action) => (
        <small key={action.to} id={`blocked-${slug}-${action.to}`} className="lifecycle-hint">{action.label}: {action.blockedReason}</small>
      ))}
      {pending && <div className="lifecycle-confirm" role="group" aria-labelledby={`confirm-${slug}`}>
        <p id={`confirm-${slug}`}><strong>{pending.label} «{name}»؟</strong> {CONFIRM_TEXT[pending.to] ?? ""}</p>
        <div className="row">
          <button ref={confirmRef} type="button" className="btn small primary" disabled={busy} onClick={() => void apply(pending)}>{busy ? "جارٍ التنفيذ…" : `تأكيد: ${pending.label}`}</button>
          <button type="button" className="btn small ghost" disabled={busy} onClick={() => { setPending(null); setMessage(""); }}>إلغاء</button>
        </div>
      </div>}
      {message && <p className="err" role="alert">{message}</p>}
    </div>
  );
}
