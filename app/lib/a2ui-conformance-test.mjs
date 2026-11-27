// Conformance: every A2UI card Wanees can send must pass the official A2UI v1.0 JSON schemas
// (packages/contracts/a2ui/v1_0, copied from github.com/a2ui-project/a2ui), so any official
// renderer — React, Flutter, SwiftUI, Compose — accepts it. Every button on those cards must
// also produce an action message the official schema and our own server both accept.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { catalogData } from "../data/catalog.ts";
import { buildRoute } from "../engine/route.ts";
import { Site, defaultProfile } from "../engine/site.ts";
import { A2UI_BASIC_CATALOG, a2uiActionMessageSchema, buildAssistantSurface, buttonAction, processA2uiMessages, validateA2uiMessages } from "./a2ui.ts";
import { computeNudges } from "./nudges.ts";

const dir = new URL("../../packages/contracts/a2ui/v1_0/", import.meta.url);
const load = (name) => JSON.parse(readFileSync(new URL(name, dir), "utf8"));

const catalog = load("basic_catalog.json");
assert.equal(catalog.$id, A2UI_BASIC_CATALOG, "we name the same basic catalog the official file defines");
// As in the official runner (specification/v1_0/test/run_tests.py): the message schema refers to the
// active catalog as "catalog.json", so the basic catalog is registered under that id.
catalog.$id = "https://a2ui.org/specification/v1_0/catalog.json";

const ajv = new Ajv2020({ strict: false, allErrors: true });
// The official runner uses ajv-formats; these are the only formats the v1.0 schemas use.
ajv.addFormat("date-time", (value) => !Number.isNaN(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value));
ajv.addFormat("date", /^\d{4}-\d{2}-\d{2}$/);
ajv.addFormat("time", /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/);
ajv.addFormat("uri", (value) => URL.canParse(value));
ajv.addSchema(load("common_types.json"));
ajv.addSchema(catalog);
const agentToRenderer = ajv.compile(load("agent_to_renderer.json"));
const rendererToAgent = ajv.compile(load("renderer_to_agent.json"));

function expectConformant(label, messages) {
  assert.ok(Array.isArray(messages) && messages.length > 0, `${label}: builds a surface`);
  assert.deepEqual(validateA2uiMessages(messages), [], `${label}: passes our own checks`);
  messages.forEach((message, index) => {
    const ok = agentToRenderer(message);
    assert.ok(ok, `${label} message ${index} breaks the A2UI v1.0 schema:\n${JSON.stringify(agentToRenderer.errors, null, 2)}`);
  });
  // Every button, tapped, sends an action the official schema and our assistant endpoint accept.
  const surface = processA2uiMessages(messages);
  const buttons = [...surface.components.values()].filter((component) => component.component === "Button");
  for (const button of buttons) {
    const action = buttonAction(surface, button.id, "2026-11-27T20:15:00.000+03:00");
    assert.ok(action, `${label}/${button.id}: a tap sends an action`);
    assert.ok(rendererToAgent(action), `${label}/${button.id} action breaks the A2UI v1.0 schema:\n${JSON.stringify(rendererToAgent.errors, null, 2)}`);
    const parsed = a2uiActionMessageSchema.safeParse(action);
    assert.ok(parsed.success, `${label}/${button.id}: our server rejects its own button: ${parsed.error?.message}`);
  }
  return buttons.length;
}

// ————— every card the assistant builds —————
const activity = (id, name, extra = {}) => ({ kind: "activity", id, name, zone: "lagoon", zoneName: "البحيرة المركزية", priceSar: 50, durationMin: 10, reasons: ["تناسب مزاجك", "قريب منك"], nextStartsAt: "20:30", ...extra });
const place = (id, name, extra = {}) => ({ kind: "location", id, name, zoneName: "البوابة الرئيسية", status: "open", accessible: true, ...extra });
let buttons = 0;

for (const intent of ["search", "faq", "schedule", "alternatives", "rest"]) {
  buttons += expectConformant(`${intent} cards`, buildAssistantSurface({
    surfaceId: `s_${intent}`,
    intent,
    sources: [activity("dolphinarium", "عرض الدولفيناريوم"), activity("giraffe", "إطعام الزرافات", { priceSar: 0 }), activity("planned", "نشاط في المسار"), activity("unknown", "شروط مجهولة", { priceSar: null, eligibilityKnown: false })],
    planIds: new Set(["planned"]),
  }));
}
buttons += expectConformant("swap alternatives", buildAssistantSurface({
  surfaceId: "s_swap",
  intent: "alternatives",
  sources: [activity("giraffe", "إطعام الزرافات", { swapFor: "dolphinarium", swapForName: "عرض الدولفيناريوم" }), activity("birds", "عرض الطيور", { swapFor: "dolphinarium" })],
}));
buttons += expectConformant("location cards", buildAssistantSurface({
  surfaceId: "s_location",
  intent: "location",
  sources: [place("wc_north", "دورات المياه الشمالية"), place("prayer", "مصلى النساء", { status: "closed", accessible: false }), { kind: "zone", id: "lagoon", name: "البحيرة المركزية" }],
}));
buttons += expectConformant("proposal card", buildAssistantSurface({
  surfaceId: "s_proposal",
  intent: "replan",
  sources: [],
  proposal: { id: "prop_123", added: ["عرض الطيور"], removed: ["عرض الدولفيناريوم"], moved: ["إطعام الزرافات"] },
}));
for (const clarifyIntent of ["add", "swap", undefined]) {
  buttons += expectConformant(`clarify (${clarifyIntent ?? "none"})`, buildAssistantSurface({
    surfaceId: `s_clarify_${clarifyIntent ?? "none"}`,
    intent: "clarify",
    sources: [],
    clarifyOptions: [{ id: "a", name: "عرض الطيور" }, { id: "b", name: "عرض الدولفيناريوم" }],
    clarifyIntent,
  }));
}
expectConformant("handoff card", buildAssistantSurface({ surfaceId: "s_handoff", intent: "handoff", sources: [], handoff: true }));
expectConformant("crowd card", buildAssistantSurface({
  surfaceId: "s_crowd",
  intent: "crowd",
  sources: [{ zoneName: "البحيرة المركزية", level: 0.72, source: "simulated" }, { zone: "gate", level: 0.3, source: "sensor" }],
}));

// ————— every nudge card, found by walking the clock through a real plan —————
const site = new Site(catalogData);
const kinds = new Set();
const shapes = new Map();
// The third plan holds a timed show, so «the show starts soon» appears too.
for (const profile of [{ ...defaultProfile(), companions_kids: false }, { ...defaultProfile(), companions_kids: true }, { ...defaultProfile(), must_include: ["dolphinarium"] }]) {
  const plan = buildRoute(site, profile);
  const end = Math.max(plan.stops.at(-1).end, profile.start_min + profile.duration_min);
  for (let now = profile.start_min; now <= end; now += 1) {
    for (const nudge of computeNudges({ site, plan, profile, nowMin: now, isOpen: true })) {
      kinds.add(nudge.kind);
      // One of each card shape: «visit ending» drops a button on the last stop.
      const shape = `${nudge.kind}:${nudge.ui[1].updateComponents.components.map((component) => component.id).join(",")}`;
      if (!shapes.has(shape)) shapes.set(shape, nudge);
    }
  }
}
assert.deepEqual([...kinds].sort(), ["leave_now", "show_soon", "visit_ending"], "the clock walk meets every kind of nudge");
for (const [shape, nudge] of shapes) buttons += expectConformant(`nudge ${shape.split(":")[0]}`, nudge.ui);
assert.ok(buttons > 20, "the conformance run tapped every kind of button");

// ————— the schemas really reject what a renderer would reject —————
const good = buildAssistantSurface({ surfaceId: "s_neg", intent: "search", sources: [activity("x", "نشاط")] });
const components = () => structuredClone(good[1]);
const rejects = (label, message) => assert.equal(agentToRenderer(message), false, `the official schema should reject: ${label}`);
rejects("an unknown version", { ...good[0], version: "0.9" });
rejects("a component outside the catalog", (() => { const m = components(); m.updateComponents.components.push({ id: "html", component: "Html", html: "<b>x</b>" }); return m; })());
rejects("a button with no action", (() => { const m = components(); const button = m.updateComponents.components.find((c) => c.component === "Button"); button.action = undefined; return m; })());
rejects("a text variant the catalog lacks", (() => { const m = components(); m.updateComponents.components.find((c) => c.component === "Text").variant = "headline1"; return m; })());
rejects("an event with an unknown field", (() => { const m = components(); m.updateComponents.components.find((c) => c.component === "Button").action.event.script = "alert(1)"; return m; })());
assert.equal(rendererToAgent({ version: "1.0", action: { name: "x", surfaceId: "s", sourceComponentId: "b", timestamp: "yesterday", context: {} } }), false, "the official schema should reject a bad timestamp");

console.log(`A2UI v1.0 conformance passed: ${buttons} buttons and ${shapes.size} nudge cards checked against the official schemas`);
