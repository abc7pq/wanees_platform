"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Short confirmations at the bottom of the screen (audit 2.3), with an optional «تراجع». A toast never
// carries the only copy of important information: errors stay inline where they happened.
export type Toast = { id: number; text: string; actionLabel?: string; onAction?: () => void };

export function useToasts(durationMs = 5000) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);
  const show = useCallback((text: string, action?: { label: string; run: () => void }) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list.slice(-2), { id, text, actionLabel: action?.label, onAction: action?.run }]);
    timers.current.set(id, setTimeout(() => dismiss(id), durationMs));
  }, [dismiss, durationMs]);
  useEffect(() => {
    const pending = timers.current;
    return () => { for (const timer of pending.values()) clearTimeout(timer); };
  }, []);
  return { toasts, show, dismiss };
}

export function ToastHost({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast">
          <span>{toast.text}</span>
          {toast.actionLabel && toast.onAction && (
            <button type="button" onClick={() => { toast.onAction?.(); dismiss(toast.id); }}>{toast.actionLabel}</button>
          )}
        </div>
      ))}
    </div>
  );
}
