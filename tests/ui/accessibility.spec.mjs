import { expect, test } from "@playwright/test";

// A dependency-free accessibility sweep (WCAG 2.2 A/AA basics) over the main visitor and organizer screens:
// Arabic RTL document, an accessible name for every control, alt text, unique ids, labelled form fields and
// a 24 × 24 px minimum target for buttons (2.5.8) and text contrast (1.4.3). It complements, not replaces, a manual screen-reader pass.
const visitor = process.env.WANEES_BASE_URL ?? "http://127.0.0.1:3100";
const admin = process.env.WANEES_ADMIN_BASE_URL ?? "http://127.0.0.1:3200";

async function audit(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && box.width > 0 && box.height > 0 && !element.closest("[aria-hidden=true], [inert]");
    };
    const text = (element) => (element.textContent ?? "").replace(/\s+/g, " ").trim();
    const byIds = (ids) => ids.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map(text).join(" ").trim();
    const name = (element) => {
      if (element.getAttribute("aria-labelledby")) return byIds(element.getAttribute("aria-labelledby"));
      if (element.getAttribute("aria-label")?.trim()) return element.getAttribute("aria-label").trim();
      if (element.id) {
        const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
        if (label && text(label)) return text(label);
      }
      const wrapping = element.closest("label");
      if (wrapping && text(wrapping)) return text(wrapping);
      if (["INPUT", "SELECT", "TEXTAREA"].includes(element.tagName)) {
        if (element.type === "submit" || element.type === "button") return element.value?.trim() ?? "";
        return element.getAttribute("title")?.trim() ?? "";
      }
      const own = text(element) || [...element.querySelectorAll("img[alt]")].map((img) => img.alt).join(" ").trim();
      return own || element.getAttribute("title")?.trim() || "";
    };
    const describe = (element) => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${element.className && typeof element.className === "string" ? `.${element.className.trim().split(/\s+/).slice(0, 2).join(".")}` : ""} «${text(element).slice(0, 30)}»`;

    const problems = [];
    const html = document.documentElement;
    if (!html.lang?.startsWith("ar")) problems.push(`html lang is "${html.lang}"`);
    if (html.dir !== "rtl") problems.push(`html dir is "${html.dir}"`);
    if (!document.title.trim()) problems.push("empty document title");
    if (!document.querySelector("main")) problems.push("no <main> landmark");
    if (![...document.querySelectorAll("h1, [role=heading][aria-level='1']")].some(visible)) problems.push("no visible h1");

    const controls = document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=tab], [role=switch], [role=checkbox], [role=radio]");
    for (const control of controls) {
      if (!visible(control) && !["checkbox", "radio"].includes(control.type)) continue;
      if (!name(control)) problems.push(`no accessible name: ${describe(control)}`);
    }
    for (const field of document.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea")) {
      if (!visible(field) && !["checkbox", "radio"].includes(field.type)) continue;
      const labelled = field.getAttribute("aria-label") || field.getAttribute("aria-labelledby") || (field.id && document.querySelector(`label[for="${CSS.escape(field.id)}"]`)) || field.closest("label");
      if (!labelled) problems.push(`form field without a label: ${describe(field)}`);
    }
    for (const image of document.querySelectorAll("img")) {
      if (!image.hasAttribute("alt")) problems.push(`img without alt: ${image.getAttribute("src")?.slice(0, 60)}`);
    }
    const seen = new Map();
    for (const element of document.querySelectorAll("[id]")) seen.set(element.id, (seen.get(element.id) ?? 0) + 1);
    for (const [id, count] of seen) if (count > 1) problems.push(`duplicate id "${id}" ×${count}`);
    for (const button of document.querySelectorAll("button, [role=button], input[type=submit], input[type=button]")) {
      if (!visible(button)) continue;
      const box = button.getBoundingClientRect();
      if (box.width < 24 || box.height < 24) problems.push(`target under 24px (${Math.round(box.width)}×${Math.round(box.height)}): ${describe(button)}`);
    }

    // Text contrast (1.4.3): 4.5:1, or 3:1 for large text. Text over a gradient or an image is skipped: it
    // cannot be measured from computed styles and needs a visual check.
    const rgba = (value) => {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const [r, g, b, a = 1] = match[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r, g, b, a };
    };
    const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
    const luminance = ({ r, g, b }) => {
      const channel = (value) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const backdrop = (element) => {
      const layers = [];
      for (let node = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.backgroundImage !== "none") return null;
        const color = rgba(style.backgroundColor);
        if (color && color.a > 0) { layers.push(color); if (color.a >= 1) break; }
      }
      return layers.reverse().reduce((under, layer) => over(layer, under), { r: 255, g: 255, b: 255, a: 1 });
    };
    const checked = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const element = walker.currentNode.parentElement;
      if (!element || checked.has(element) || !walker.currentNode.textContent.trim() || !visible(element)) continue;
      checked.add(element);
      const style = getComputedStyle(element);
      if (Number(style.opacity) === 0 || element.closest("[disabled], [aria-disabled=true]")) continue;
      const foreground = rgba(style.color);
      const behind = backdrop(element);
      if (!foreground || !behind) continue;
      const [light, dark] = [luminance(over(foreground, behind)), luminance(behind)].sort((a, b) => b - a);
      const ratio = (light + 0.05) / (dark + 0.05);
      const size = parseFloat(style.fontSize);
      const needed = size >= 24 || (Number(style.fontWeight) >= 700 && size >= 18.66) ? 3 : 4.5;
      if (ratio < needed) problems.push(`contrast ${ratio.toFixed(2)}:1 < ${needed}:1 (${style.color}): ${describe(element)}`);
    }
    return problems;
  });
}

async function expectAccessible(page, label) {
  await expect(page.locator("main").first()).toBeVisible();
  // Client pages render their heading after hydration; audit the page people see, not the empty shell.
  await expect(page.locator("h1").first()).toBeVisible();
  expect(await audit(page), label).toEqual([]);
}

test("the accessibility sweep itself catches each kind of problem", async ({ page }) => {
  await page.goto(`${visitor}/kiosk/boulevard-world-demo`);
  await expectAccessible(page, "kiosk before faults");
  await page.evaluate(() => {
    const main = document.querySelector("main");
    main.insertAdjacentHTML("beforeend", `
      <button type="button" style="width:40px;height:40px"></button>
      <input type="text" style="width:120px">
      <img src="/icon.png" width="20" height="20">
      <span id="twice">a</span><span id="twice">b</span>
      <button type="button" style="width:16px;height:16px;padding:0;min-width:0;min-height:0">x</button>
      <p style="color:#bbbbbb;background:#ffffff;font-size:14px">نص باهت</p>`);
  });
  const problems = (await audit(page)).join("\n");
  for (const expected of ["no accessible name: button", "form field without a label: input", "img without alt", 'duplicate id "twice"', "target under 24px", "contrast 1.92:1 < 4.5:1"]) {
    expect(problems).toContain(expected);
  }
});

const publicPages = [
  ["visitor home", `${visitor}/`],
  ["Boulevard World", `${visitor}/e/boulevard-world-demo`],
  ["second event", `${visitor}/e/sample-festival`],
  ["live board", `${visitor}/board/boulevard-world-demo`],
  ["kiosk without a token", `${visitor}/kiosk/boulevard-world-demo`],
  ["organizer sign-in", `${admin}/login`],
];

for (const [label, url] of publicPages) {
  test(`accessibility basics: ${label}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url);
    // Bounded: on the dev server Firefox may never report the network idle, and an unbounded wait used up
    // the whole test timeout on a page that had already rendered. The checks below wait for the content.
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    await expectAccessible(page, label);
  });
}

test("accessibility basics: a built plan and the organizer workspace", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${visitor}/e/boulevard-world-demo`);
  const box = page.getByRole("textbox", { name: "قل لي وش بالك" });
  await expect(box).toBeEnabled();
  await box.fill("طلعة شباب، عندنا ساعتين");
  await page.getByRole("button", { name: /^يلا/ }).click();
  await expect(page.getByRole("heading", { name: "مسارك الليلة" })).toBeVisible();
  await expectAccessible(page, "plan");

  const password = process.env.WANEES_OWNER_PASSWORD;
  if (!password) throw new Error("Set WANEES_OWNER_PASSWORD to the seeded test organizer password.");
  await page.goto(`${admin}/login`);
  await page.getByRole("textbox", { name: /البريد الإلكتروني/ }).pressSequentially("owner@wanees.demo");
  await page.getByRole("textbox", { name: "كلمة المرور", exact: true }).pressSequentially(password);
  await page.getByRole("button", { name: "دخول", exact: true }).click();
  await expect(page.getByRole("heading", { name: "لوحة إدارة ونيس" })).toBeVisible();
  await expectAccessible(page, "organizer dashboard");
  await page.goto(`${admin}/events/sample-festival`);
  await expect(page.getByRole("heading", { name: "شاشات الاستعلام" })).toBeVisible();
  await expectAccessible(page, "event workspace");
});

// Dark mode (identity guide night purple): the same sweep, contrast included, on every visitor screen.
const nightPurple = "rgb(26, 11, 61)";
async function buildPlan(page) {
  await page.route("https://server.arcgisonline.com/**", (route) => route.abort());
  await page.goto(`${visitor}/e/boulevard-world-demo`);
  await page.getByRole("textbox", { name: "قل لي وش بالك" }).fill("طلعة شباب، عندنا ساعتين");
  await page.getByRole("button", { name: /^يلا/ }).click();
  await expect(page.getByRole("heading", { name: "مسارك الليلة" })).toBeVisible();
}
const pageBackground = (page) => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);

test.describe("on a phone set to dark", () => {
  test.use({ colorScheme: "dark" });
  test("Wanees stays light on a dark phone until the visitor chooses otherwise", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${visitor}/e/boulevard-world-demo`);
    await expect(page.getByRole("textbox", { name: "قل لي وش بالك" })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("light");
    expect(await pageBackground(page)).toBe("rgb(255, 255, 255)");
    expect(await page.locator('meta[name="theme-color"]').first().getAttribute("content")).toBe("#ffffff");
  });
  test("accessibility basics in dark mode: welcome, plan and every tab", async ({ page, context }) => {
    // «مثل الجوال» in «أنا»: the phone is dark, so Wanees is too.
    await context.addCookies([{ name: "wanees-theme", value: "system", url: visitor }]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("https://server.arcgisonline.com/**", (route) => route.abort());
    await page.goto(`${visitor}/e/boulevard-world-demo`);
    // Following the phone, the page sends one bar colour per phone setting; the dark one is the night purple.
    expect(await page.locator('meta[name="theme-color"][media*="dark"]').getAttribute("content")).toBe("#1a0b3d");
    await expect(page.getByRole("textbox", { name: "قل لي وش بالك" })).toBeEnabled();
    await expect.poll(() => pageBackground(page)).toBe(nightPurple);
    await expectAccessible(page, "dark welcome");
    await buildPlan(page);
    await expectAccessible(page, "dark plan");
    const nav = page.getByRole("navigation", { name: "التنقل الرئيسي" });
    for (const tab of ["الخريطة", "ونيس", "حولي", "أنا"]) {
      await nav.getByRole("button", { name: new RegExp(`^${tab}`) }).click();
      await expect(nav.getByRole("button", { name: new RegExp(`^${tab}`) })).toHaveAttribute("aria-current", "page");
      await expectAccessible(page, `dark ${tab}`);
    }
  });
});

test("«المظهر» in «أنا»: light by default, dark across a reload, «مثل الجوال», and back to light", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await buildPlan(page);
  expect(await pageBackground(page)).toBe("rgb(255, 255, 255)");
  await page.getByRole("navigation", { name: "التنقل الرئيسي" }).getByRole("button", { name: /^أنا/ }).click();
  const appearance = page.getByRole("radiogroup", { name: "المظهر" });
  await expect(appearance.getByRole("radio", { name: "فاتح" })).toHaveAttribute("aria-checked", "true");
  await appearance.getByRole("radio", { name: "داكن" }).click();
  await expect.poll(() => pageBackground(page)).toBe(nightPurple);
  // The server reads the choice, so the next page load starts dark (no light flash).
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  await expect(page.getByRole("radio", { name: "داكن" })).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => pageBackground(page)).toBe(nightPurple);
  // This phone is light, so following it is light.
  await page.getByRole("radio", { name: "مثل الجوال" }).click();
  await expect.poll(() => pageBackground(page)).toBe("rgb(255, 255, 255)");
  expect((await page.context().cookies()).find((cookie) => cookie.name === "wanees-theme")?.value).toBe("system");
  await page.getByRole("radio", { name: "فاتح" }).click();
  await expect.poll(() => pageBackground(page)).toBe("rgb(255, 255, 255)");
  expect((await page.context().cookies()).some((cookie) => cookie.name === "wanees-theme")).toBe(false);
});
