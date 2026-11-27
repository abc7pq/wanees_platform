"use client";

import { useEffect, useState, type ReactNode } from "react";
import { TAB_LABELS, type VisitorTabId } from "@/lib/visitor-routes";

/**
 * The app's bottom navigation (audit 2.2): five tabs, right to left in RTL, each with an icon, a
 * label and an active state announced with aria-current. On desktop the same nav becomes a side rail
 * (CSS). It hides while the on-screen keyboard is open, so the chat composer keeps the space.
 */
export function BottomNav({ tabs, active, onSelect, icon, badges = {}, hidden = false }: {
  tabs: readonly VisitorTabId[];
  active: VisitorTabId;
  onSelect: (tab: VisitorTabId) => void;
  icon: (tab: VisitorTabId) => ReactNode;
  badges?: Partial<Record<VisitorTabId, string | null>>;
  /** Full-screen screens (the compass guide, a call) hide the navigation. */
  hidden?: boolean;
}) {
  const keyboardOpen = useKeyboardOpen();
  return (
    <nav className="bottom-nav" aria-label="التنقل الرئيسي" data-keyboard={keyboardOpen ? "open" : undefined} hidden={hidden}>
      {tabs.map((tab) => {
        const badge = badges[tab];
        return (
          <button
            key={tab}
            id={`visitor-tab-${tab}`}
            type="button"
            className="bottom-nav-item"
            aria-current={active === tab ? "page" : undefined}
            aria-controls={`visitor-panel-${tab}`}
            onClick={() => onSelect(tab)}
          >
            <span className="bottom-nav-icon" aria-hidden="true">{icon(tab)}</span>
            <span className="bottom-nav-label">{TAB_LABELS[tab]}</span>
            {badge && <span className="bottom-nav-badge">{badge}<span className="sr-only"> بانتظارك</span></span>}
          </button>
        );
      })}
    </nav>
  );
}

/** True while the visual viewport is much shorter than the layout viewport (the keyboard is up). */
function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setOpen(window.innerHeight - viewport.height > 150);
    viewport.addEventListener("resize", update);
    update();
    return () => viewport.removeEventListener("resize", update);
  }, []);
  return open;
}
