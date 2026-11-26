import assert from "node:assert/strict";
import {
  A2UI_BASIC_CATALOG,
  A2UI_COMPONENTS,
  a2uiActionMessageSchema,
  actionToVisitorMessage,
  buildAssistantSurface,
  processA2uiMessages,
  resolveDynamic,
  surfaceProposalId,
  validateA2uiMessages,
} from "./a2ui.ts";
import { assistantRequestSchema } from "./api-contracts.ts";

const activity = (id, name, extra = {}) => ({ kind: "activity", id, name, zone: "lagoon", zoneName: "البحيرة المركزية", priceSar: 50, durationMin: 10, reasons: ["تناسب مزاجك"], sourceRef: `catalog:x/activity:${id}`, ...extra });

// ————— سطح نتائج البحث —————
const search = buildAssistantSurface({
  surfaceId: "s_search",
  intent: "search",
  sources: [activity("dolphinarium", "عرض الدولفيناريوم"), activity("giraffe", "إطعام الزرافات", { priceSar: 0 }), activity("planned", "نشاط في المسار"), activity("unknown_price", "سعر مجهول", { priceSar: undefined })],
  planIds: new Set(["planned"]),
});
assert.equal(search.length, 2);
assert.equal(search[0].version, "1.0");
assert.equal(search[0].createSurface.catalogId, A2UI_BASIC_CATALOG);
assert.equal(search[0].createSurface.sendDataModel, false);
assert.deepEqual(validateA2uiMessages(search), [], "builder output is valid A2UI");
const components = search[1].updateComponents.components;
assert.ok(components.every((component) => A2UI_COMPONENTS.includes(component.component)), "only catalog components");
assert.equal(components.filter((component) => component.id === "root").length, 1);
const ids = components.map((component) => component.id);
assert.ok(ids.includes("act0_add") && ids.includes("act1_add"), "addable activities get «أضف لمساري»");
assert.ok(!ids.includes("act2_add"), "an activity already in the plan gets no add button");
assert.ok(!ids.includes("act3_add"), "unknown price → no add button");
assert.ok(ids.includes("act3_dir"), "directions are always offered");
// الحقائق في نموذج البيانات، والمكوّنات تربطها بمسارات
const surface = processA2uiMessages(search);
assert.equal(resolveDynamic(surface.components.get("act0_name").text, surface.data), "عرض الدولفيناريوم");
assert.equal(resolveDynamic(surface.components.get("act0_meta").text, surface.data), "البحيرة المركزية · 50 ريال · 10 دقائق");
assert.equal(resolveDynamic(surface.components.get("act1_meta").text, surface.data), "البحيرة المركزية · مجاني · 10 دقائق");
assert.equal(resolveDynamic(surface.components.get("act0_add").action.event.context.activityId, surface.data), "dolphinarium");

// ————— اقتراح بانتظار الموافقة —————
const proposal = buildAssistantSurface({ surfaceId: "s_prop", intent: "swap", sources: [], proposal: { id: "it_1", added: ["إطعام الزرافات"], removed: ["عرض الدولفيناريوم"], moved: [] } });
assert.deepEqual(validateA2uiMessages(proposal), []);
const propSurface = processA2uiMessages(proposal);
assert.equal(resolveDynamic(propSurface.components.get("prop_title").text, propSurface.data), "اقتراح بانتظار موافقتك", "a proposal never reads as applied");
assert.equal(propSurface.components.get("prop_accept").action.event.name, "respond_to_proposal");
assert.equal(resolveDynamic(propSurface.components.get("prop_accept").action.event.context.proposalId, propSurface.data), "it_1");
assert.equal(propSurface.components.get("prop_keep").action.event.context.decision, "keep_current");

assert.equal(surfaceProposalId(proposal), "it_1");
assert.equal(surfaceProposalId(search), null);

// ————— أسئلة توضيحية، زحام، بلاغ —————
const clarifyAdd = buildAssistantSurface({ surfaceId: "s_c", intent: "add", sources: [], clarifyIntent: "add", clarifyOptions: [{ id: "a", name: "أ" }, { id: "b", name: "ب" }] });
assert.deepEqual(validateA2uiMessages(clarifyAdd), []);
assert.equal(processA2uiMessages(clarifyAdd).components.get("choice0").action.event.userMessage, "أضف «أ» لمساري");
const crowd = buildAssistantSurface({ surfaceId: "s_crowd", intent: "crowd", sources: [{ zone: "lagoon", zoneName: "البحيرة", level: 0.82, source: "simulated" }] });
const crowdSurface = processA2uiMessages(crowd);
assert.equal(resolveDynamic(crowdSurface.components.get("crowd0_meta").text, crowdSurface.data), "إشغال 82% · تقدير تجريبي");
const handoff = buildAssistantSurface({ surfaceId: "s_h", intent: "help", sources: [], handoff: true });
assert.deepEqual(validateA2uiMessages(handoff), []);
assert.equal(buildAssistantSurface({ surfaceId: "s_none", intent: "chat", sources: [activity("x", "x")] }), null, "small talk carries no surface");

// ————— المحقق يلتقط الأخطاء —————
const broken = structuredClone(search);
broken[1].updateComponents.components.push({ id: "evil", component: "Script", text: "x" });
broken[1].updateComponents.components.find((component) => component.id === "root").children.push("missing_child");
const codes = validateA2uiMessages(broken).map((error) => error.message);
assert.ok(codes.some((message) => message.includes("not in the catalog")));
assert.ok(codes.some((message) => message.includes("Unknown child missing_child")));
assert.ok(validateA2uiMessages([search[1]]).some((error) => error.code === "INTEGRITY_ERROR"), "updateComponents before createSurface");
assert.ok(validateA2uiMessages([...search, search[0]]).some((error) => error.message === "Surface created twice."));

// ————— العارض: updateDataModel وdeleteSurface —————
const updated = processA2uiMessages([...search, { version: "1.0", updateDataModel: { surfaceId: "s_search", path: "/items/0/name", value: "اسم محدث" } }]);
assert.equal(resolveDynamic(updated.components.get("act0_name").text, updated.data), "اسم محدث");
assert.equal(processA2uiMessages([...search, { version: "1.0", deleteSurface: { surfaceId: "s_search" } }]), null);
assert.equal(processA2uiMessages([{ version: "0.8", createSurface: { surfaceId: "old", catalogId: "x" } }]), null, "other versions are ignored");

// ————— إجراءات الزائر عائدة للوكيل —————
const action = { version: "1.0", action: { name: "add_to_plan", surfaceId: "s_search", sourceComponentId: "act0_add", timestamp: "2026-11-25T18:00:00.000Z", userMessage: "أضف «عرض الدولفيناريوم» لمساري", context: { activityId: "dolphinarium" } } };
assert.equal(a2uiActionMessageSchema.safeParse(action).success, true);
assert.equal(a2uiActionMessageSchema.safeParse({ ...action, action: { ...action.action, name: "delete_everything" } }).success, false, "unknown action names are rejected");
assert.equal(a2uiActionMessageSchema.safeParse({ ...action, action: { ...action.action, context: { x: { nested: true } } } }).success, false, "context values must be scalars");
const names = { dolphinarium: "عرض الدولفيناريوم" };
assert.equal(actionToVisitorMessage(action.action, (id) => names[id]), "أضف عرض الدولفيناريوم لمساري");
assert.equal(actionToVisitorMessage({ ...action.action, name: "choose", context: { activityId: "dolphinarium", intent: "swap" } }, (id) => names[id]), "اقصد عرض الدولفيناريوم");
assert.equal(actionToVisitorMessage({ ...action.action, context: { activityId: "hidden" } }, (id) => names[id]), null, "unknown activity ids do nothing");
assert.equal(actionToVisitorMessage({ ...action.action, name: "get_directions", context: { activityId: "dolphinarium" } }, (id) => names[id]), null, "app-local actions are not sent as text");
assert.equal(actionToVisitorMessage({ ...action.action, name: "swap_with", context: { activityId: "dolphinarium", targetId: "dolphinarium" } }, (id) => names[id]), "بدّل «عرض الدولفيناريوم» بـ«عرض الدولفيناريوم»", "swap_with becomes a named swap");
assert.equal(actionToVisitorMessage({ ...action.action, name: "swap_with", context: { activityId: "dolphinarium" } }, (id) => names[id]), null, "swap_with needs both stops");

// ————— عقد الطلب: رسالة أو إجراء، واحد فقط —————
assert.equal(assistantRequestSchema.safeParse({ message: "هلا" }).success, true);
assert.equal(assistantRequestSchema.safeParse({ action }).success, true);
assert.equal(assistantRequestSchema.safeParse({ message: "هلا", action }).success, false);
assert.equal(assistantRequestSchema.safeParse({}).success, false);

{
  // list_alternatives cards: «بدّلها بهذا» instead of «أضف», and a start time on schedule cards.
  const surface = buildAssistantSurface({ surfaceId: "alt", intent: "alternatives", sources: [{ kind: "activity", id: "planet360", name: "سينما الكوكب 360", zone: "z", zoneName: "منطقة", priceSar: 30, durationMin: 20, swapFor: "grendizer", swapForName: "تجربة جريندايزر" }] });
  assert.equal(surface[1].updateComponents.components.find((c) => c.id === "act0_swap").action.event.userMessage, "بدّل «تجربة جريندايزر» بـ«سينما الكوكب 360»", "the tap carries the visible chat message the app sends");
  assert.deepEqual(validateA2uiMessages(surface), [], "alternatives surface validates");
  const components = surface[1].updateComponents.components;
  const swap = components.find((component) => component.id === "act0_swap");
  assert.equal(swap.action.event.name, "swap_with");
  assert.deepEqual(swap.action.event.context, { activityId: { "@path": "/items/0/id" }, targetId: { "@path": "/items/0/swapFor" } });
  assert.equal(surface[0].createSurface.dataModel.items[0].swapFor, "grendizer");
  assert.ok(!components.some((component) => component.id === "act0_add"), "no add button on an alternative");
  const schedule = buildAssistantSurface({ surfaceId: "sch", intent: "schedule", sources: [{ kind: "activity", id: "dolphinarium", name: "عرض", zone: "z", zoneName: "منطقة", priceSar: 50, durationMin: 30, nextStartsAt: "18:30" }] });
  assert.deepEqual(validateA2uiMessages(schedule), []);
  assert.match(schedule[0].createSurface.dataModel.items[0].meta, /^يبدأ 18:30/);
}

console.log("A2UI surface builder, validator, renderer state, and action contract tests passed");
