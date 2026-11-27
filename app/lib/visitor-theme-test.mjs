// The appearance choice in «أنا»: light is the default; dark, or following the phone, is the visitor's choice.
import assert from "node:assert/strict";
const theme = await import("./visitor-theme.ts");

assert.deepEqual([...theme.THEMES], ["light", "dark", "system"], "light first: it is the default");
assert.equal(theme.parseTheme("dark"), "dark");
assert.equal(theme.parseTheme("system"), "system");
// No cookie, or anything unknown, is the light default: a dark phone alone does not turn Wanees dark.
for (const value of [undefined, "", "light", "DARK", "<script>", 1]) assert.equal(theme.parseTheme(value), "light");

assert.equal(theme.themeCookie("dark"), "wanees-theme=dark; Max-Age=31536000; Path=/; SameSite=Lax");
assert.equal(theme.themeCookie("system", true), "wanees-theme=system; Max-Age=31536000; Path=/; SameSite=Lax; Secure");
// Back to «فاتح» removes the cookie instead of storing the default.
assert.equal(theme.themeCookie("light"), "wanees-theme=; Max-Age=0; Path=/; SameSite=Lax");

assert.equal(theme.themeFromCookieHeader("a=1; wanees-theme=dark; b=2"), "dark");
assert.equal(theme.themeFromCookieHeader("wanees-theme=system"), "system");
assert.equal(theme.themeFromCookieHeader("wanees-theme-old=dark"), "light");
assert.equal(theme.themeFromCookieHeader(""), "light");

// The browser bar: light unless the visitor chose dark, or chose the phone and the phone is dark.
assert.equal(theme.themeColorFor("light", true), theme.THEME_COLORS.light);
assert.equal(theme.themeColorFor("dark", false), theme.THEME_COLORS.dark);
assert.equal(theme.themeColorFor("system", true), theme.THEME_COLORS.dark);
assert.equal(theme.themeColorFor("system", false), theme.THEME_COLORS.light);

// The night colour is the identity guide's dark purple family, not black.
assert.match(theme.THEME_COLORS.dark, /^#1a0b3d$/);
console.log("visitor-theme: ok");
