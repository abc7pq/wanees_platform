import type { Viewport } from "next";
import { cookies } from "next/headers";
import { THEME_COLORS, THEME_COOKIE, parseTheme } from "./visitor-theme";

// The browser bar follows the visitor's «المظهر» choice: light by default, the night purple when they chose
// dark, and the phone's own setting when they chose «مثل الجوال». Shared by /demo and /e/{slug}.
export async function visitorViewport(): Promise<Viewport> {
  const choice = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  if (choice !== "system") return { themeColor: THEME_COLORS[choice] };
  return {
    themeColor: [
      { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
      { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
    ],
  };
}
