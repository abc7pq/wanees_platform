"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

type SheetState = { waneesSheet?: string } | null;
// Sheets mounted right now. React may mount an effect twice in development; the history entry is only
// pushed once per sheet and only removed when the sheet is really gone.
const openSheets = new Set<string>();

/**
 * The visitor app's sheet (audit 2.3). A native modal <dialog> gives the focus trap, Escape and the
 * inert page behind it. On top of that: the phone's Back button closes the sheet instead of leaving
 * the app, dragging the grab handle down dismisses it, tapping the handle switches between half and
 * full height, and the page behind does not scroll while it is open (CSS).
 */
export function VisitorDialog({ label, className = "", opener, onClose, children }: {
  label: string;
  className?: string;
  opener?: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const initialOpener = useRef(opener);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const sheetId = useId();
  const [snap, setSnap] = useState<"half" | "full">("half");
  const drag = useRef<{ startY: number; dy: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const returnFocusTo = initialOpener.current ?? document.activeElement;
    dialog.showModal();
    // Back closes the sheet: it gets its own history entry, and leaving it by Back is a close.
    let closedByBack = false;
    openSheets.add(sheetId);
    if ((window.history.state as SheetState)?.waneesSheet !== sheetId) {
      window.history.pushState({ ...(window.history.state ?? {}), waneesSheet: sheetId }, "");
    }
    const onPop = (event: PopStateEvent) => {
      if ((event.state as SheetState)?.waneesSheet === sheetId) return;
      closedByBack = true;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      openSheets.delete(sheetId);
      dialog.close();
      setTimeout(() => {
        if (!closedByBack && !openSheets.has(sheetId) && (window.history.state as SheetState)?.waneesSheet === sheetId) window.history.back();
      }, 0);
      if (returnFocusTo instanceof HTMLElement && returnFocusTo.isConnected && returnFocusTo.getClientRects().length) {
        returnFocusTo.focus({ preventScroll: true });
      }
    };
  }, [sheetId]);

  const moveTo = (dy: number) => {
    const dialog = ref.current;
    if (dialog) dialog.style.transform = dy > 0 ? `translateY(${dy}px)` : "";
  };

  return (
    <dialog
      ref={ref}
      className={`visitor-dialog bottom-sheet ${className}`}
      aria-label={label}
      data-snap={snap}
      data-dragging={dragging || undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {/* Pointer-only: keyboard and screen-reader users close with «إغلاق» or Escape. */}
      <div
        className="sheet-grab"
        aria-hidden="true"
        onClick={() => { if (!drag.current || drag.current.dy < 6) setSnap((value) => value === "half" ? "full" : "half"); }}
        onPointerDown={(event) => {
          drag.current = { startY: event.clientY, dy: 0 };
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          drag.current.dy = event.clientY - drag.current.startY;
          moveTo(drag.current.dy);
        }}
        onPointerUp={() => {
          const dy = drag.current?.dy ?? 0;
          setDragging(false);
          moveTo(0);
          if (dy > 120) onClose();
          else if (dy < -60) setSnap("full");
          setTimeout(() => { drag.current = null; }, 0);
        }}
        onPointerCancel={() => { drag.current = null; setDragging(false); moveTo(0); }}
      />
      <header className="sheet-heading">
        <h2>{label}</h2>
        <button type="button" className="btn-icon" aria-label="إغلاق" onClick={onClose}>×</button>
      </header>
      {children}
    </dialog>
  );
}
