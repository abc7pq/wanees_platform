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

const timeMarkup = renderToStaticMarkup(createElement(ItineraryTimeRange, { start: "18:00", end: "18:20" }));
assert.match(timeMarkup, /dir="ltr"/);
assert.match(timeMarkup, /unicode-bidi:isolate/);
assert.ok(timeMarkup.includes(">18:00 – 18:20<"), "itinerary range must preserve chronological start–end order");

const demoSource = await readFile(new URL("../app/demo/page.tsx", import.meta.url), "utf8");
for (const className of ["container visitor-flow welcome-flow", "container qwrap visitor-flow", "container visitor-plan"]) {
  assert.match(demoSource, new RegExp(`<main className="${className}"`), `demo ${className} view must expose a main landmark`);
}

const layoutSource = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
assert.doesNotMatch(layoutSource, /maximumScale\s*:/, "viewport must not disable browser pinch zoom");

console.log("quiz progress and accessibility regressions passed");
