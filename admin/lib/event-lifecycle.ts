// Event lifecycle: the single table of allowed status changes for an event.
// Pure on purpose (no database, no framework imports) so the route, the dashboard
// and admin/engine/event-lifecycle-test.mjs all use the same rules.
//
//   DRAFT ──publish──▶ PUBLISHED ──go live──▶ LIVE ──finish──▶ COMPLETED ──archive──▶ ARCHIVED
//     │                  │   ▲                                                       │
//     │                  └───┘ unpublish (back to DRAFT)                              │
//     └──────────── archive ──────────────────────────────────────────────────────▶ │
//                    PUBLISHED ── archive ─────────────────────────────────────────▶ │
//   ARCHIVED ──restore──▶ DRAFT (never straight back to visitors)
//
// Visitors only ever see PUBLISHED and LIVE events (packages/engine/src/db-catalog.ts).
// A LIVE event cannot be archived directly: finish it first, so the season has an end.

export const EVENT_STATUSES = ["DRAFT", "PUBLISHED", "LIVE", "COMPLETED", "ARCHIVED"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/** Statuses served to visitors by the visitor app. Kept here for the dashboard's wording. */
export const VISITOR_VISIBLE_STATUSES: readonly EventStatus[] = ["PUBLISHED", "LIVE"];

export const EVENT_STATUS_TRANSITIONS: Readonly<Record<EventStatus, readonly EventStatus[]>> = {
  DRAFT: ["PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["LIVE", "DRAFT", "ARCHIVED"],
  LIVE: ["COMPLETED"],
  COMPLETED: ["ARCHIVED"],
  ARCHIVED: ["DRAFT"],
};

/** Targets that put the event in front of visitors need a published catalog version. */
const NEEDS_PUBLISHED_CATALOG: readonly EventStatus[] = ["PUBLISHED", "LIVE"];
/** Targets the API refuses without an explicit `confirm: true`. */
const NEEDS_CONFIRMATION: readonly EventStatus[] = ["ARCHIVED", "COMPLETED"];

export type TransitionContext = { hasPublishedCatalog: boolean };
export type TransitionRefusal = {
  code: "EVENT_STATUS_INVALID" | "EVENT_TRANSITION_NOT_ALLOWED" | "CATALOG_NOT_PUBLISHED" | "CONFIRMATION_REQUIRED";
  message: string;
};

export function isEventStatus(value: unknown): value is EventStatus {
  return typeof value === "string" && (EVENT_STATUSES as readonly string[]).includes(value);
}

export function requiresConfirmation(to: EventStatus) {
  return NEEDS_CONFIRMATION.includes(to);
}

/** Returns null when the change is allowed, otherwise a refusal with an Arabic message. */
export function checkEventTransition(from: unknown, to: unknown, context: TransitionContext, confirmed = false): TransitionRefusal | null {
  if (!isEventStatus(from) || !isEventStatus(to)) return { code: "EVENT_STATUS_INVALID", message: "حالة الفعالية غير معروفة." };
  if (!EVENT_STATUS_TRANSITIONS[from].includes(to)) {
    return { code: "EVENT_TRANSITION_NOT_ALLOWED", message: "لا يمكن نقل الفعالية من هذه الحالة إلى الحالة المطلوبة." };
  }
  if (NEEDS_PUBLISHED_CATALOG.includes(to) && !context.hasPublishedCatalog) {
    return { code: "CATALOG_NOT_PUBLISHED", message: "انشر نسخة من الكتالوج أولًا قبل إظهار الفعالية للزوار." };
  }
  if (requiresConfirmation(to) && !confirmed) {
    return { code: "CONFIRMATION_REQUIRED", message: "هذا الإجراء يخفي الفعالية عن الزوار ويحتاج إلى تأكيد صريح." };
  }
  return null;
}

/** Arabic verb for the button that moves an event from `from` to `to`. */
export function transitionActionLabel(from: EventStatus, to: EventStatus) {
  if (to === "PUBLISHED") return "نشر للزوار";
  if (to === "LIVE") return "بدء التشغيل المباشر";
  if (to === "COMPLETED") return "إنهاء الفعالية";
  if (to === "ARCHIVED") return "أرشفة";
  if (to === "DRAFT") return from === "ARCHIVED" ? "استعادة كمسودة" : "إلغاء النشر";
  return to;
}

export type NextAction = { to: EventStatus; label: string; requiresConfirmation: boolean; blockedReason: string | null };

/** Every next status allowed from `from`, with the reason it is blocked right now (if any). */
export function nextEventActions(from: unknown, context: TransitionContext): NextAction[] {
  if (!isEventStatus(from)) return [];
  return EVENT_STATUS_TRANSITIONS[from].map((to) => {
    const refusal = checkEventTransition(from, to, context, true);
    return { to, label: transitionActionLabel(from, to), requiresConfirmation: requiresConfirmation(to), blockedReason: refusal?.message ?? null };
  });
}
