"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function VisitorDialog({ label, className = "", opener, onClose, children }: {
  label: string;
  className?: string;
  opener?: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const initialOpener = useRef(opener);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const returnFocusTo = initialOpener.current ?? document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (returnFocusTo instanceof HTMLElement && returnFocusTo.isConnected && returnFocusTo.getClientRects().length) {
        returnFocusTo.focus({ preventScroll: true });
      }
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={`visitor-dialog bottom-sheet ${className}`}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="sheet-heading">
        <h2>{label}</h2>
        <button type="button" className="btn-icon" aria-label="إغلاق" onClick={onClose}>×</button>
      </header>
      {children}
    </dialog>
  );
}
