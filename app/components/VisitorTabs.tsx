"use client";

import { useSyncExternalStore, type ReactNode } from "react";

const layoutQuery = "(min-width: 1024px) and (min-height: 600px)";

function subscribe(update: () => void) {
  const media = window.matchMedia(layoutQuery);
  media.addEventListener("change", update);
  return () => media.removeEventListener("change", update);
}

export function useWideVisitorLayout() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(layoutQuery).matches, () => false);
}

const labels = { itinerary: "المسار", map: "الخريطة", assistant: "المساعد" };
export type VisitorTab = keyof typeof labels;

export function VisitorTabs({ tabs, active, onSelect, icon }: {
  tabs: VisitorTab[];
  active: VisitorTab;
  onSelect: (tab: VisitorTab) => void;
  icon: (tab: VisitorTab) => ReactNode;
}) {
  return (
    <div className="visitor-tabs" role="tablist" aria-label="أقسام الزيارة">
      {tabs.map((tab, index) => (
        <button
          key={tab}
          id={`visitor-tab-${tab}`}
          aria-controls={`visitor-panel-${tab}`}
          aria-selected={active === tab}
          tabIndex={active === tab ? 0 : -1}
          type="button"
          role="tab"
          onClick={() => onSelect(tab)}
          onKeyDown={(event) => {
            const last = tabs.length - 1;
            let next = index;
            switch (event.key) {
              case "ArrowLeft": next = (index + 1) % tabs.length; break;
              case "ArrowRight": next = (index + last) % tabs.length; break;
              case "Home": next = 0; break;
              case "End": next = last; break;
              default: return;
            }
            event.preventDefault();
            onSelect(tabs[next]);
            document.getElementById(`visitor-tab-${tabs[next]}`)?.focus();
          }}
        >
          <span aria-hidden="true">{icon(tab)}</span>
          {labels[tab]}
        </button>
      ))}
    </div>
  );
}
