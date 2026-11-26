// A2UI v1.0 (https://a2ui.org): واجهة يبنيها الوكيل كبيانات JSON معلنة، لا كود.
// في ونيس الخادم يبني السطح حتميًا من نتيجة المحرك (الحاسوب يحسب)، والنموذج يكتب الجملة فقط.
// الرسائل متوافقة مع كتالوج A2UI الأساسي، فنفس الحمولة تُرسم بعارض React هنا اليوم،
// وبعارضات Flutter/SwiftUI/Compose الرسمية في تطبيق الجوال لاحقًا.
import { z } from "zod";
import { minutesText } from "./agent-persona.ts";

export const A2UI_VERSION = "1.0";
export const A2UI_BASIC_CATALOG = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json";

/** المكوّنات المسموحة من الكتالوج الأساسي. أي مكوّن غيرها يُرفض في الخادم ويُتجاهل في العارض. */
export const A2UI_COMPONENTS = ["Column", "Row", "Card", "Text", "Button", "Divider"] as const;
export type A2uiComponentName = (typeof A2UI_COMPONENTS)[number];

export type DynamicString = string | { "@path": string };
export type A2uiEventAction = { event: { name: A2uiActionName; userMessage?: string; context?: Record<string, DynamicString> } };

export type A2uiComponent = {
  id: string;
  component: A2uiComponentName;
  children?: string[];
  child?: string;
  text?: DynamicString;
  variant?: "caption" | "body" | "default" | "primary" | "borderless";
  action?: A2uiEventAction;
  justify?: "start" | "center" | "end" | "spaceBetween";
  align?: "start" | "center" | "end" | "stretch";
};

export type A2uiMessage =
  | { version: "1.0"; createSurface: { surfaceId: string; catalogId: string; sendDataModel?: boolean; dataModel?: Record<string, unknown> } }
  | { version: "1.0"; updateComponents: { surfaceId: string; components: A2uiComponent[] } }
  | { version: "1.0"; updateDataModel: { surfaceId: string; path?: string; value: unknown } }
  | { version: "1.0"; deleteSurface: { surfaceId: string } };

/** أحداث الأزرار التي يفهمها ونيس. add_to_plan وchoose تمر بالخادم؛ الباقي محلي في التطبيق. */
export const A2UI_ACTIONS = ["add_to_plan", "choose", "swap_with", "shorten_plan", "get_directions", "show_on_map", "respond_to_proposal"] as const;
export type A2uiActionName = (typeof A2UI_ACTIONS)[number];

const id = z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]{0,119}$/);
/** رسالة A2UI من العارض إلى الوكيل: {"version":"1.0","action":{…}} */
export const a2uiActionMessageSchema = z.object({
  version: z.literal(A2UI_VERSION),
  action: z.object({
    name: z.enum(A2UI_ACTIONS),
    surfaceId: id,
    sourceComponentId: id,
    timestamp: z.string().datetime({ offset: true }),
    userMessage: z.string().trim().max(200).optional(),
    context: z.record(z.string().max(40), z.union([z.string().max(120), z.number(), z.boolean(), z.null()])).default({}),
  }).strict(),
}).strict();
export type A2uiActionMessage = z.infer<typeof a2uiActionMessageSchema>;

// ————— بناء السطح —————

type SourceRow = Record<string, unknown>;

export type SurfaceInput = {
  surfaceId: string;
  intent: string;
  sources: ReadonlyArray<SourceRow>;
  /** معرّفات محطات المسار الحالي: لا نعرض «أضف» لنشاط موجود أصلًا. */
  planIds?: ReadonlySet<string>;
  proposal?: { id: string; added: string[]; removed: string[]; moved: string[] } | null;
  clarifyOptions?: Array<{ id: string; name: string }>;
  /** نية السؤال التوضيحي: «أضف» تختلف عن «بدّل/شيل». */
  clarifyIntent?: string;
  handoff?: boolean;
  simulatedCrowd?: boolean;
};

class SurfaceBuilder {
  components: A2uiComponent[] = [];
  data: Record<string, unknown> = {};
  readonly surfaceId: string;
  constructor(surfaceId: string) { this.surfaceId = surfaceId; }
  add(component: A2uiComponent) { this.components.push(component); return component.id; }
  text(id: string, text: DynamicString, variant: "caption" | "body" = "body") { return this.add({ id, component: "Text", text, variant }); }
  button(id: string, label: string, variant: "primary" | "default" | "borderless", action: A2uiEventAction) {
    this.text(`${id}_label`, label);
    return this.add({ id, component: "Button", child: `${id}_label`, variant, action });
  }
}

function priceText(value: unknown) {
  if (value == null) return "السعر غير مؤكد";
  return Number(value) === 0 ? "مجاني" : `${value} ريال`;
}

function activityCard(b: SurfaceBuilder, row: SourceRow, index: number, planIds: ReadonlySet<string>) {
  const base = `/items/${index}`;
  const key = `act${index}`;
  const name = String(row.name);
  const why = Array.isArray(row.reasons) ? row.reasons.slice(0, 2).join(" · ") : "";
  (b.data.items as unknown[])[index] = {
    id: row.id,
    name,
    meta: [row.nextStartsAt ? `يبدأ ${row.nextStartsAt}` : null, row.zoneName ?? row.zone, priceText(row.priceSar), row.durationMin != null ? minutesText(Number(row.durationMin)) : null, row.eligibilityKnown === false ? "شروط المشاركة غير مؤكدة" : null].filter(Boolean).join(" · "),
    why,
  };
  const lines = [b.text(`${key}_name`, { "@path": `${base}/name` }), b.text(`${key}_meta`, { "@path": `${base}/meta` }, "caption")];
  if (why) lines.push(b.text(`${key}_why`, { "@path": `${base}/why` }, "caption"));
  const buttons: string[] = [];
  const addable = row.priceSar != null && row.eligibilityKnown !== false && !planIds.has(String(row.id));
  if (typeof row.swapFor === "string") {
    (b.data.items as Array<Record<string, unknown>>)[index].swapFor = row.swapFor;
    // The app sends a tapped button as its userMessage (shown in the chat); without one the tap is dropped.
    const swapMessage = typeof row.swapForName === "string" ? `بدّل «${row.swapForName}» بـ«${name}»` : `بدّلها بـ«${name}»`;
    buttons.push(b.button(`${key}_swap`, "بدّلها بهذا", "primary", { event: { name: "swap_with", userMessage: swapMessage, context: { activityId: { "@path": `${base}/id` }, targetId: { "@path": `${base}/swapFor` } } } }));
  } else if (addable) buttons.push(b.button(`${key}_add`, "أضف لمساري", "primary", { event: { name: "add_to_plan", userMessage: `أضف «${name}» لمساري`, context: { activityId: { "@path": `${base}/id` } } } }));
  buttons.push(b.button(`${key}_dir`, "دلّني", "borderless", { event: { name: "get_directions", context: { targetId: { "@path": `${base}/id` } } } }));
  lines.push(b.add({ id: `${key}_actions`, component: "Row", children: buttons, justify: "start" }));
  b.add({ id: `${key}_col`, component: "Column", children: lines });
  return b.add({ id: key, component: "Card", child: `${key}_col` });
}

function placeCard(b: SurfaceBuilder, row: SourceRow, index: number) {
  const base = `/items/${index}`;
  const key = `loc${index}`;
  const isZone = row.kind === "zone";
  (b.data.items as unknown[])[index] = {
    id: row.id,
    name: String(row.name),
    meta: isZone ? "منطقة داخل الفعالية" : [row.zoneName, row.status === "open" ? "مفتوح" : "غير مفتوح حاليًا", row.accessible ? "مهيأ لذوي الإعاقة" : null].filter(Boolean).join(" · "),
  };
  const buttons = [b.button(`${key}_dir`, "دلّني", "primary", { event: { name: "get_directions", context: { targetId: { "@path": `${base}/id` } } } })];
  if (!isZone) buttons.push(b.button(`${key}_map`, "على الخريطة", "borderless", { event: { name: "show_on_map", context: { targetId: { "@path": `${base}/id` } } } }));
  const lines = [b.text(`${key}_name`, { "@path": `${base}/name` }), b.text(`${key}_meta`, { "@path": `${base}/meta` }, "caption"), b.add({ id: `${key}_actions`, component: "Row", children: buttons })];
  b.add({ id: `${key}_col`, component: "Column", children: lines });
  return b.add({ id: key, component: "Card", child: `${key}_col` });
}

/** يبني سطح A2UI للرد، أو null إذا ما فيه شيء يستحق واجهة. */
export function buildAssistantSurface(input: SurfaceInput): A2uiMessage[] | null {
  const b = new SurfaceBuilder(input.surfaceId);
  b.data.items = [];
  const planIds = input.planIds ?? new Set<string>();
  const rootChildren: string[] = [];

  if (input.proposal) {
    const p = input.proposal;
    b.data.proposal = { id: p.id };
    const lines = [b.text("prop_title", "اقتراح بانتظار موافقتك")];
    if (p.added.length) lines.push(b.text("prop_add", `يضيف: ${p.added.join("، ")}`, "caption"));
    if (p.removed.length) lines.push(b.text("prop_remove", `يشيل: ${p.removed.join("، ")}`, "caption"));
    if (p.moved.length) lines.push(b.text("prop_move", `يتغير موعد: ${p.moved.join("، ")}`, "caption"));
    lines.push(b.add({ id: "prop_actions", component: "Row", children: [
      b.button("prop_accept", "اعتمد الاقتراح", "primary", { event: { name: "respond_to_proposal", context: { proposalId: { "@path": "/proposal/id" }, decision: "accept" } } }),
      b.button("prop_keep", "خلّ مساري", "default", { event: { name: "respond_to_proposal", context: { proposalId: { "@path": "/proposal/id" }, decision: "keep_current" } } }),
    ] }));
    b.add({ id: "prop_col", component: "Column", children: lines });
    rootChildren.push(b.add({ id: "proposal", component: "Card", child: "prop_col" }));
  }

  if (input.clarifyOptions?.length) {
    const choices = input.clarifyOptions.slice(0, 4).map((option, index) =>
      b.button(`choice${index}`, option.name, "default", { event: { name: "choose", userMessage: input.clarifyIntent === "add" ? `أضف «${option.name}» لمساري` : `أقصد ${option.name}`, context: { activityId: option.id, intent: input.clarifyIntent ?? "" } } }));
    rootChildren.push(b.add({ id: "choices", component: "Row", children: choices }));
  }

  if (input.handoff) {
    b.text("handoff_title", "وصل بلاغك لفريق العمليات");
    b.text("handoff_note", "ابقَ قريبًا من أقرب موظف، وفريقنا يتابع معك.", "caption");
    b.add({ id: "handoff_col", component: "Column", children: ["handoff_title", "handoff_note"] });
    rootChildren.push(b.add({ id: "handoff", component: "Card", child: "handoff_col" }));
  }

  const cardIntents = new Set(["search", "location", "faq", "schedule", "alternatives", "rest"]);
  if (cardIntents.has(input.intent)) {
    input.sources.slice(0, 4).forEach((row, index) => {
      if (row.kind === "activity") rootChildren.push(activityCard(b, row, index, planIds));
      else if (row.kind === "location" || row.kind === "zone") rootChildren.push(placeCard(b, row, index));
    });
  }

  if (input.intent === "crowd" && input.sources.length) {
    const rows = input.sources.slice(0, 6).map((row, index) => {
      (b.data.items as unknown[])[index] = { name: String(row.zoneName ?? row.zone), meta: `إشغال ${Math.round(Number(row.level) * 100)}%${row.source === "simulated" ? " · تقدير تجريبي" : ""}` };
      b.text(`crowd${index}_name`, { "@path": `/items/${index}/name` });
      b.text(`crowd${index}_meta`, { "@path": `/items/${index}/meta` }, "caption");
      return b.add({ id: `crowd${index}`, component: "Row", children: [`crowd${index}_name`, `crowd${index}_meta`], justify: "spaceBetween" });
    });
    b.add({ id: "crowd_col", component: "Column", children: rows });
    rootChildren.push(b.add({ id: "crowd", component: "Card", child: "crowd_col" }));
  }

  if (!rootChildren.length) return null;
  b.add({ id: "root", component: "Column", children: rootChildren });
  return [
    { version: A2UI_VERSION, createSurface: { surfaceId: input.surfaceId, catalogId: A2UI_BASIC_CATALOG, sendDataModel: false, dataModel: b.data } },
    { version: A2UI_VERSION, updateComponents: { surfaceId: input.surfaceId, components: b.components } },
  ];
}

// ————— التحقق قبل الإرسال (بصيغة أخطاء A2UI) —————

export type A2uiError = { code: "VALIDATION_FAILED" | "INTEGRITY_ERROR"; surfaceId: string; path: string; message: string };

const MAX_COMPONENTS = 120;

export function validateA2uiMessages(messages: readonly A2uiMessage[]): A2uiError[] {
  const errors: A2uiError[] = [];
  const surfaces = new Set<string>();
  messages.forEach((message, index) => {
    if (message.version !== A2UI_VERSION) errors.push({ code: "VALIDATION_FAILED", surfaceId: "", path: `/${index}/version`, message: "Unsupported A2UI version." });
    if ("createSurface" in message) {
      if (surfaces.has(message.createSurface.surfaceId)) errors.push({ code: "INTEGRITY_ERROR", surfaceId: message.createSurface.surfaceId, path: `/${index}`, message: "Surface created twice." });
      surfaces.add(message.createSurface.surfaceId);
    }
    if ("updateComponents" in message) {
      const { surfaceId, components } = message.updateComponents;
      if (!surfaces.has(surfaceId)) errors.push({ code: "INTEGRITY_ERROR", surfaceId, path: `/${index}`, message: "updateComponents before createSurface." });
      if (components.length > MAX_COMPONENTS) errors.push({ code: "VALIDATION_FAILED", surfaceId, path: `/${index}/components`, message: "Too many components." });
      const ids = new Set<string>();
      components.forEach((component, at) => {
        if (ids.has(component.id)) errors.push({ code: "VALIDATION_FAILED", surfaceId, path: `/${index}/components/${at}/id`, message: `Duplicate id ${component.id}.` });
        ids.add(component.id);
        if (!(A2UI_COMPONENTS as readonly string[]).includes(component.component)) errors.push({ code: "VALIDATION_FAILED", surfaceId, path: `/${index}/components/${at}/component`, message: `Component ${component.component} is not in the catalog.` });
        if (component.component === "Button" && (!component.child || !component.action)) errors.push({ code: "VALIDATION_FAILED", surfaceId, path: `/${index}/components/${at}`, message: "Button needs child and action." });
        if (component.component === "Card" && !component.child) errors.push({ code: "VALIDATION_FAILED", surfaceId, path: `/${index}/components/${at}/child`, message: "Card needs exactly one child." });
        if (component.component === "Text" && component.text == null) errors.push({ code: "VALIDATION_FAILED", surfaceId, path: `/${index}/components/${at}/text`, message: "Text needs text." });
      });
      if (!ids.has("root")) errors.push({ code: "VALIDATION_FAILED", surfaceId, path: `/${index}/components`, message: "No root component." });
      components.forEach((component, at) => {
        for (const ref of [...(component.children ?? []), ...(component.child ? [component.child] : [])]) {
          if (!ids.has(ref)) errors.push({ code: "VALIDATION_FAILED", surfaceId, path: `/${index}/components/${at}`, message: `Unknown child ${ref}.` });
        }
      });
    }
  });
  return errors;
}

/** يحوّل حدث زر وارد إلى رسالة زائر حتمية للمحرك. الأحداث المحلية (اتجاهات، خريطة، اقتراح) تُرجع null. */
export function actionToVisitorMessage(action: A2uiActionMessage["action"], activityName: (id: string) => string | undefined) {
  if (action.name === "shorten_plan") return "قصّر الجولة";
  const activityId = typeof action.context.activityId === "string" ? action.context.activityId : "";
  const name = activityId ? activityName(activityId) : undefined;
  if (!name) return null;
  if (action.name === "add_to_plan") return `أضف ${name} لمساري`;
  if (action.name === "choose") return action.context.intent === "add" ? `أضف ${name} لمساري` : `اقصد ${name}`;
  if (action.name === "swap_with") {
    const targetName = typeof action.context.targetId === "string" ? activityName(action.context.targetId) : undefined;
    return targetName ? `بدّل «${targetName}» بـ«${name}»` : null;
  }
  return null;
}

// ————— معالجة الرسائل في العارض (مشتركة بين React والاختبارات) —————

export type A2uiSurfaceState = { surfaceId: string; components: Map<string, A2uiComponent>; data: Record<string, unknown> };

function pointerGet(data: unknown, pointer: string): unknown {
  if (!pointer.startsWith("/")) return undefined;
  return pointer.slice(1).split("/").reduce<unknown>((value, raw) => {
    if (value == null || typeof value !== "object") return undefined;
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    return (value as Record<string, unknown>)[key];
  }, data);
}

function pointerSet(data: Record<string, unknown>, pointer: string | undefined, value: unknown) {
  if (!pointer || pointer === "/") return (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const keys = pointer.slice(1).split("/");
  const next = structuredClone(data);
  let cursor: Record<string, unknown> = next;
  keys.slice(0, -1).forEach((key) => {
    if (!cursor[key] || typeof cursor[key] !== "object") cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  });
  const last = keys.at(-1)!;
  if (value === null) delete cursor[last];
  else cursor[last] = value;
  return next;
}

export function resolveDynamic(value: DynamicString | number | boolean | null | undefined, data: Record<string, unknown>) {
  if (value && typeof value === "object" && "@path" in value) {
    const resolved = pointerGet(data, value["@path"]);
    return resolved == null ? "" : resolved;
  }
  return value ?? "";
}

/** يطبّق رسائل A2UI بالترتيب ويرجع آخر سطح صالح. */
export function processA2uiMessages(messages: readonly A2uiMessage[]): A2uiSurfaceState | null {
  let surface: A2uiSurfaceState | null = null;
  for (const message of messages) {
    if (!message || message.version !== A2UI_VERSION) continue;
    if ("createSurface" in message) {
      surface = { surfaceId: message.createSurface.surfaceId, components: new Map(), data: (message.createSurface.dataModel ?? {}) as Record<string, unknown> };
    } else if ("updateComponents" in message && surface?.surfaceId === message.updateComponents.surfaceId) {
      for (const component of message.updateComponents.components.slice(0, 200)) surface.components.set(component.id, component);
    } else if ("updateDataModel" in message && surface?.surfaceId === message.updateDataModel.surfaceId) {
      surface.data = pointerSet(surface.data, message.updateDataModel.path, message.updateDataModel.value);
    } else if ("deleteSurface" in message && surface?.surfaceId === message.deleteSurface.surfaceId) {
      surface = null;
    }
  }
  return surface;
}


/** معرّف الاقتراح الذي يحمله السطح (إن وُجد)، لتعطيل أزراره بعد حسم الاقتراح. في ملف خفيف بلا zod كي تستخدمه صفحة الزائر. */
export { surfaceProposalId } from "./a2ui-proposal.ts";
