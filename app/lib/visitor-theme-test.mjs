// The appearance choice in «أنا»: only light and dark are pinned; anything else follows the phone.
import assert from "node:assert/strict";
const theme = await import("./visitor-theme.ts");

assert.equal(theme.parseTheme("dark"), "dark");
assert.equal(theme.parseTheme("light"), "light");
for (const value of [undefined, "", "system", "DARK", "<script>", 1]) assert.equal(theme.parseTheme(value), "system");

assert.equal(theme.themeCookie("dark"), "wanees-theme=dark; Max-Age=31536000; Path=/; SameSite=Lax");
assert.equal(theme.themeCookie("light", true), "wanees-theme=light; Max-Age=31536000; Path=/; SameSite=Lax; Secure");
// Back to «تلقائي» removes the cookie instead of storing a third value.
assert.equal(theme.themeCookie("system"), "wanees-theme=; Max-Age=0; Path=/; SameSite=Lax");

assert.equal(theme.themeFromCookieHeader("a=1; wanees-theme=dark; b=2"), "dark");
assert.equal(theme.themeFromCookieHeader("wanees-theme-old=dark"), "system");
assert.equal(theme.themeFromCookieHeader(""), "system");

// The night colour is the identity guide's dark purple family, not black.
assert.match(theme.THEME_COLORS.dark, /^#1a0b3d$/);
console.log("visitor-theme: ok");
