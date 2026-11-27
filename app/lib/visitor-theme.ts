// The visitor app's appearance: light (the default, the white page), dark, or follow the phone, chosen in «أنا».
// The choice is a device preference, not visitor data: one cookie with no identifier, read by the root
// layout so the server sends <html data-theme> and the first paint is already in the right theme.
export const THEME_COOKIE = "wanees-theme";
export const THEMES = ["light", "dark", "system"] as const;
export type ThemeChoice = (typeof THEMES)[number];

// The identity guide's light page and its night purple, for the browser bar on a phone.
export const THEME_COLORS = { light: "#ffffff", dark: "#1a0b3d" } as const;

/** No cookie, or anything unknown, is light: a dark phone alone does not turn Wanees dark. */
export function parseTheme(value: unknown): ThemeChoice {
  return value === "dark" || value === "system" ? value : "light";
}

/** The Set-Cookie value for a choice. «فاتح» (the default) clears the cookie. */
export function themeCookie(choice: ThemeChoice, secure = false) {
  const tail = `; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;
  return choice === "light" ? `${THEME_COOKIE}=; Max-Age=0${tail}` : `${THEME_COOKIE}=${choice}; Max-Age=31536000${tail}`;
}

/** Reads the choice back from document.cookie. */
export function themeFromCookieHeader(header: string) {
  const match = header.split(/;\s*/).find((part) => part.startsWith(`${THEME_COOKIE}=`));
  return parseTheme(match?.slice(THEME_COOKIE.length + 1));
}

/** The browser bar colour: light unless the visitor chose dark, or chose the phone and the phone is dark. */
export function themeColorFor(choice: ThemeChoice, phoneIsDark: boolean) {
  return choice === "dark" || (choice === "system" && phoneIsDark) ? THEME_COLORS.dark : THEME_COLORS.light;
}
