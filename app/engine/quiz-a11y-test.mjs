import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QuizProgress, QuizInterestButton, ItineraryTimeRange } from "../lib/quiz-progress.ts";

for (const [step, expected] of [[1, "1 / 5"], [5, "5 / 5"]]) {
  const markup = renderToStaticMarkup(createElement(QuizProgress, { current: step, total: 5 }));
  assert.match(markup, /dir="ltr"/, "progress counter must establish LTR direction");
  assert.match(markup, /unicode-bidi:isolate/, "progress counter must isolate from surrounding RTL text");
  assert.ok(markup.includes(`>${expected}<`), `step ${step} should render as ${expected}`);
}

for (const selected of [false, true]) {
  const markup = renderToStaticMarkup(createElement(QuizInterestButton, { selected, children: "عروض" }));
  assert.match(markup, new RegExp(`aria-pressed="${selected}"`));
}

// 12-hour times carry an Arabic suffix (ص/م), so each time is isolated on its own and the dash stays between them.
const timeMarkup = renderToStaticMarkup(createElement(ItineraryTimeRange, { start: "6:00 م", end: "6:20 م" }));
assert.match(timeMarkup, /unicode-bidi:isolate/);
assert.doesNotMatch(timeMarkup, /dir="ltr"/, "a left-to-right run would scramble the Arabic suffix");
assert.ok(timeMarkup.includes("<bdi>6:00 م</bdi> – <bdi>6:20 م</bdi>"), "itinerary range must preserve chronological start–end order");

const demoSource = await readFile(new URL("../app/demo/page.tsx", import.meta.url), "utf8");
for (const className of ["container visitor-flow welcome-flow", "container visitor-plan"]) {
  assert.match(demoSource, new RegExp(`<main className="${className}"`), `demo ${className} view must expose a main landmark`);
}

// The visit starts with a sentence: there is no questionnaire screen to fall back to (audit 1.1).
assert.doesNotMatch(demoSource, /phase === "quiz"|setPhase("quiz")/, "the visitor app must not show the old questionnaire");

const layoutSource = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
assert.doesNotMatch(layoutSource, /maximumScale\s*:/, "viewport must not disable browser pinch zoom");

console.log("quiz progress and accessibility regressions passed");
