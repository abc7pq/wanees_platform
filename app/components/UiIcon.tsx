// The identity guide's icon style for interface controls: thin rounded outline strokes, no emoji
// (docs/BRAND_IDENTITY.md, «الرموز»). Decorative: the control's text or aria-label carries the meaning.
const PATHS = {
  toilets: <><circle cx="7" cy="4.5" r="1.7"/><circle cx="17" cy="4.5" r="1.7"/><path d="M12 3v18M5 9h4l.8 6H8.5v6m-3-6v6m0-6H4.2L5 9m10 0h4l1 6h-1.5v6m-3-6v6m0-6H14l1-6"/></>,
  food: <><path d="M5 3v6a2 2 0 0 0 4 0V3M7 11v10M7 3v4"/><path d="M17 21V3c-1.9.6-3 3-3 6.5V13h3"/></>,
  prayer: <><path d="M4 21h16M6 21v-7a6 6 0 0 1 12 0v7M10 21v-3a2 2 0 0 1 4 0v3M12 8V5M12 5a1.5 1.5 0 1 0 0-3"/></>,
  firstAid: <><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M9 5V3.5h6V5M12 9.5v6M9 12.5h6"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8h.01"/></>,
  seat: <><path d="M7 3.5v8.5h10V3.5M6 12l-1 8.5M18 12l1 8.5M6.5 16h11"/></>,
  close: <path d="m18 6-12 12M6 6l12 12"/>,
  compass: <><circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5L16 8Z"/></>,
  map: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15m6-12v15"/></>,
  speaker: <><path d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4Z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></>,
  speakerOff: <><path d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4Z"/><path d="m16 9.5 5 5m0-5-5 5"/></>,
} as const;

export type UiIconName = keyof typeof PATHS;

export function UiIcon({ name, size = 22 }: { name: UiIconName; size?: number }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{PATHS[name]}</svg>
  );
}
