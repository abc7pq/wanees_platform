"use client";

import { useEffect, useState } from "react";
import { THEME_COLORS, THEMES, themeCookie, themeFromCookieHeader, type ThemeChoice as Choice } from "@/lib/visitor-theme";

const LABELS: Record<Choice, string> = { system: "تلقائي", light: "فاتح", dark: "داكن" };

/** «المظهر» in «أنا»: follow the phone, or keep Wanees light or dark on this device. */
export function ThemeChoice() {
  const [choice, setChoice] = useState<Choice>("system");
  useEffect(() => setChoice(themeFromCookieHeader(document.cookie)), []);

  function choose(next: Choice) {
    setChoice(next);
    document.cookie = themeCookie(next, window.location.protocol === "https:");
    const root = document.documentElement;
    if (next === "system") root.removeAttribute("data-theme");
    else root.dataset.theme = next;
    // The phone's browser bar follows the same choice.
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
      if (!meta.dataset.original) meta.dataset.original = meta.content;
      meta.content = next === "system" ? meta.dataset.original : THEME_COLORS[next];
    });
  }

  return (
    <section aria-labelledby="me-theme">
      <h2 id="me-theme">المظهر</h2>
      <div className="theme-choice" role="radiogroup" aria-labelledby="me-theme">
        {THEMES.map((item) => (
          <button key={item} type="button" role="radio" aria-checked={choice === item} onClick={() => choose(item)}>{LABELS[item]}</button>
        ))}
      </div>
      <p className="visitor-note">«تلقائي» يمشي مع جوالك: داكن بالليل إذا جوالك داكن.</p>
    </section>
  );
}
