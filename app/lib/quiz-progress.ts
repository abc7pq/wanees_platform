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

/**
 * «5:04 م – 5:14 م». Each time is isolated (`<bdi>`), so its digits and its ص/م stay together and the
 * dash stays between the two times; the range itself follows the page direction (start first).
 */
export function ItineraryTimeRange({ start, end }: { start: string; end: string }) {
  return createElement("span", { style: { unicodeBidi: "isolate", whiteSpace: "nowrap" } }, createElement("bdi", null, start), " – ", createElement("bdi", null, end));
}
