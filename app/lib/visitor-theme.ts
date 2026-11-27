// The visitor app's appearance: follow the phone (default), or pinned to light or dark from «أنا».
// The choice is a device preference, not visitor data: one cookie with no identifier, read by the root
// layout so the server sends <html data-theme> and the first paint is already in the right theme.
export const THEME_COOKIE = "wanees-theme";
export const THEMES = ["system", "light", "dark"] as const;
export type ThemeChoice = (typeof THEMES)[number];

// The identity guide's light page and its night purple, for the browser bar on a phone.
export const THEME_COLORS = { light: "#ffffff", dark: "#1a0b3d" } as const;

export function parseTheme(value: unknown): ThemeChoice {
  return value === "light" || value === "dark" ? value : "system";
}

/** The Set-Cookie value for a choice. «system» clears the cookie. */
export function themeCookie(choice: ThemeChoice, secure = false) {
  const tail = `; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;
  return choice === "system" ? `${THEME_COOKIE}=; Max-Age=0${tail}` : `${THEME_COOKIE}=${choice}; Max-Age=31536000${tail}`;
}

/** Reads the choice back from document.cookie. */
export function themeFromCookieHeader(header: string) {
  const match = header.split(/;\s*/).find((part) => part.startsWith(`${THEME_COOKIE}=`));
  return parseTheme(match?.slice(THEME_COOKIE.length + 1));
}
