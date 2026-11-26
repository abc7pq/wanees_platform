import { createElement, type ReactNode } from "react";

export function QuizProgress({ current, total }: { current: number; total: number }) {
  return createElement(
    "span",
    { dir: "ltr", role: "status", "aria-label": `السؤال ${current} من ${total}`, style: { unicodeBidi: "isolate" } },
    `${current} / ${total}`,
  );
}

export function QuizInterestButton({ selected, children, onClick, className }: { selected: boolean; children: ReactNode; onClick?: () => void; className?: string }) {
  return createElement("button", { type: "button", className, "aria-pressed": selected, onClick }, children);
}

export function ItineraryTimeRange({ start, end }: { start: string; end: string }) {
  return createElement("span", { dir: "ltr", style: { unicodeBidi: "isolate" } }, `${start} – ${end}`);
}
