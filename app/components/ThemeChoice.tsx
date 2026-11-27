"use client";

import { useEffect, useState } from "react";
import { THEME_COLORS, THEMES, themeColorFor, themeCookie, themeFromCookieHeader, type ThemeChoice as Choice } from "@/lib/visitor-theme";

const LABELS: Record<Choice, string> = { light: "فاتح", dark: "داكن", system: "مثل الجوال" };

/** «المظهر» in «أنا»: light by default; dark, or following the phone, on this device. */
export function ThemeChoice() {
  const [choice, setChoice] = useState<Choice>("light");
  useEffect(() => setChoice(themeFromCookieHeader(document.cookie)), []);

  function choose(next: Choice) {
    setChoice(next);
    document.cookie = themeCookie(next, window.location.protocol === "https:");
    const root = document.documentElement;
    if (next === "system") root.removeAttribute("data-theme");
    else root.dataset.theme = next;
    // The phone's browser bar follows the same choice. A bar tied to a media query keeps its own colour
    // under «مثل الجوال».
    const phoneIsDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
      meta.content = next === "system" && meta.media
        ? (meta.media.includes("dark") ? THEME_COLORS.dark : THEME_COLORS.light)
        : themeColorFor(next, phoneIsDark);
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
      <p className="visitor-note">«فاتح» هو الأصل. «مثل الجوال» يصير داكن إذا جوالك داكن.</p>
    </section>
  );
}
