import { expect, test } from "@playwright/test";

const visitor = process.env.WANEES_BASE_URL ?? "http://127.0.0.1:3100";
const admin = process.env.WANEES_ADMIN_BASE_URL ?? "http://127.0.0.1:3200";
const sampleEvent = "sample-festival";
const widths = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 667, height: 375 },
  { width: 820, height: 1180 },
  { width: 1180, height: 820 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
];

async function expectResponsive(page) {
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("main")).toBeVisible();
  const sizes = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
    clippedControls: [...document.querySelectorAll("main button, main input, main select, header a")].filter((element) => {
      if (element.closest(".map-card, [aria-hidden=true]")) return false;
      // A sideways-scrolling strip (suggestion chips) is reachable by swiping: not clipped.
      for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
        if (/auto|scroll/.test(getComputedStyle(node).overflowX) && node.scrollWidth > node.clientWidth) return false;
      }
      const bounds = element.getBoundingClientRect();
      return bounds.width > 0 && (bounds.left < -1 || bounds.right > document.documentElement.clientWidth + 1);
    }).map((element) => element.getAttribute("aria-label") || element.textContent?.trim()),
  }));
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.width + 1);
  expect(sizes.clippedControls).toEqual([]);
}

/** A tab in the app's bottom navigation (a side rail on desktop). */
function navTab(page, name) {
  return page.getByRole("navigation", { name: "التنقل الرئيسي" }).getByRole("button", { name: new RegExp(`^${name}`) });
}

async function buildItinerary(page, path) {
  await page.goto(`${visitor}${path}`);
  // Audit 1.1: the first screen is a conversation. An example chip types a sentence; nothing is required.
  const box = page.getByRole("textbox", { name: "قل لي وش بالك" });
  await expect(box).toBeEnabled();
  await page.getByRole("button", { name: "طلعة شباب" }).click();
  await expect(box).toHaveValue("طلعة شباب");
  await box.fill("طلعة شباب، عندنا ساعتين");
  await page.getByRole("button", { name: /^يلا/ }).click();
  await expect(page.getByRole("heading", { name: "مسارك الليلة" })).toBeVisible();
  // The defaults the plan used are chips the visitor can tap to correct.
  await expect(page.getByRole("group", { name: /افتراضات الجولة/ })).toBeVisible();
}

async function signIn(page) {
  const password = process.env.WANEES_OWNER_PASSWORD;
  if (!password) throw new Error("Set WANEES_OWNER_PASSWORD to the seeded test organizer password.");
  await page.goto(`${admin}/login`);
  // Target the form fields by role: the local demo-credentials panel adds "copy" buttons with the same labels.
  await page.getByRole("textbox", { name: /البريد الإلكتروني/ }).pressSequentially("owner@wanees.demo");
  await page.getByRole("textbox", { name: "كلمة المرور", exact: true }).pressSequentially(password);
  await page.getByRole("button", { name: "دخول", exact: true }).click();
  await expect(page.getByRole("heading", { name: "لوحة إدارة ونيس" })).toBeVisible();
}

test("public pages and organizer sign-in fit the device matrix", async ({ page }) => {
  for (const size of widths) {
    await page.setViewportSize(size);
    await page.goto(visitor);
    await expect(page.getByRole("link", { name: "جرّب ونيس" })).toBeVisible();
    await expectResponsive(page);
    await page.goto(`${visitor}/demo`);
    const start = page.getByRole("textbox", { name: "قل لي وش بالك" });
    await expect(start).toBeEnabled();
    if (size.height < 470) await expect(start).toBeInViewport({ ratio: 1 });
    await expectResponsive(page);
    // /demo settles its own address after loading; leaving before that lets WebKit report an interrupted navigation.
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    await page.goto(`${visitor}/ops`);
    await expect(page.getByRole("heading", { name: "لوحة المشغّل" })).toBeVisible();
    await expectResponsive(page);
    await page.goto(`${admin}/login`);
    await expect(page.getByRole("textbox", { name: "كلمة المرور", exact: true })).toBeVisible();
    await expectResponsive(page);
  }
});

test("visitor tabs, directions focus, and chat draft survive viewport changes", async ({ page }) => {
  await page.setViewportSize(widths[1]);
  await page.route("https://server.arcgisonline.com/**", (route) => route.abort());
  await buildItinerary(page, "/e/boulevard-world-demo");
  await expectResponsive(page);
  await expect(page.locator(".stop-card").first()).toBeVisible();
  const itinerary = navTab(page, "مساري");
  const map = navTab(page, "الخريطة");
  const assistant = navTab(page, "ونيس");
  await map.click();
  await expect(map).toHaveAttribute("aria-current", "page");
  await expect(page).toHaveURL(/\/e\/boulevard-world-demo\/map$/);
  // The illustrated park map needs no tiles, so it renders even with satellite imagery blocked.
  await expect(page.getByRole("application", { name: /خريطة تفاعلية للمناطق/ })).toBeVisible();
  const directions = page.getByRole("button", { name: "اتجاهات المشي", exact: true });
  await directions.click();
  const dialog = page.getByRole("dialog", { name: "اتجاهات المشي" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "إغلاق" })).toBeFocused();
  await page.setViewportSize(widths[2]);
  await expect(dialog).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(directions).toBeFocused();
  await assistant.click();
  const composer = page.getByRole("textbox", { name: "اكتب طلبك" });
  await composer.fill("وين دورات المياه؟");
  await itinerary.click();
  await expect(composer).toBeHidden();
  await assistant.click();
  await expect(composer).toHaveValue("وين دورات المياه؟");
  await page.setViewportSize(widths[4]);
  await expect(page.getByRole("heading", { name: "مسارك الليلة" })).toBeVisible();
  await expect(composer).toBeVisible();
  await composer.press("Enter");
  await expect(page.getByRole("log").locator(".bubble.user").last()).toContainText("وين دورات المياه؟");
  await expect(page.getByRole("log").locator(".bubble.agent").nth(1)).toBeVisible();
  for (const size of widths) {
    await page.setViewportSize(size);
    await expect(composer).toBeVisible();
    await expectResponsive(page);
  }
});

test("the second event and visitor recovery retain their own context", async ({ page }) => {
  await page.setViewportSize(widths[0]);
  await buildItinerary(page, `/events/${sampleEvent}`);
  await expect(page.getByRole("heading", { name: "مهرجان ونيس التجريبي" })).toBeVisible();
  await expectResponsive(page);
  await page.goto(`${visitor}/events/missing-ui-fixture`);
  // A missing event says so and offers the home page; retrying a link to nothing cannot help.
  await expect(page).toHaveURL(/\/e\/missing-ui-fixture$/);
  await expect(page.getByRole("alert").filter({ hasText: "ما لقينا هذي الفعالية" })).toBeVisible();
  await expect(page.getByRole("link", { name: "الرئيسية", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "إعادة المحاولة" })).toHaveCount(0);
  await expectResponsive(page);
  await page.goto(`${visitor}/missing-ui-page`);
  await expect(page.getByRole("heading", { name: "الصفحة غير موجودة" })).toBeVisible();
});

test("organizer navigation, event form and catalog fit phone and desktop", async ({ page }) => {
  await page.setViewportSize(widths[0]);
  await signIn(page);
  await expectResponsive(page);
  await page.getByRole("navigation", { name: "التنقل الرئيسي" }).getByRole("link", { name: "مساحات الفعاليات" }).click();
  await page.getByRole("button", { name: "فعالية جديدة" }).click();
  await expect(page.getByLabel("اسم الفعالية")).toBeVisible();
  await expectResponsive(page);
  // Exact: each event card now also has an «إلغاء النشر» (unpublish) button.
  await page.getByRole("button", { name: "إلغاء", exact: true }).click();
  await page.locator(".event-tile").filter({ hasText: sampleEvent }).getByRole("link", { name: "فتح مساحة الإدارة" }).click();
  await expect(page.getByRole("heading", { name: "إصدارات الكتالوج" })).toBeVisible();
  await expect(page.locator(".responsive-table .cell-label").first()).toBeVisible();
  await expectResponsive(page);
  for (const size of widths.slice(2)) {
    await page.setViewportSize(size);
    await expect(page.getByRole("table").first()).toBeVisible();
    if (size.width > 760) await expect(page.locator(".responsive-table .cell-label").first()).toBeHidden();
    await expectResponsive(page);
  }
  await page.goto(`${admin}/venues/legacy`);
  await expect(page).toHaveURL(`${admin}/events`);
});

test("an organizer can edit a draft and revoke a live update on a phone", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Writes shared seeded data once per run.");
  await page.setViewportSize(widths[1]);
  await signIn(page);
  await page.goto(`${admin}/events/${sampleEvent}`);
  await page.getByRole("button", { name: "نسخ مسودة" }).click();
  await expect(page.getByRole("heading", { name: "إضافة نشاط" })).toBeVisible();
  await page.getByRole("button", { name: "تعديل", exact: true }).first().click();
  const name = page.locator("#catalog-edit-name");
  await name.fill("نشاط تجريبي لاختبار الواجهة");
  await page.getByRole("button", { name: "حفظ", exact: true }).click();
  await expect(page.getByText("تم حفظ النشاط في المسودة.")).toBeVisible();
  await expect(page.getByRole("table").first().getByText("نشاط تجريبي لاختبار الواجهة")).toBeVisible();
  await expectResponsive(page);

  await page.goto(admin);
  await page.locator("#dashboard-event").selectOption(sampleEvent);
  await expect(page.locator("#activity-update-activity")).toBeEnabled();
  await page.locator("#activity-update-type").selectOption("DELAY");
  await page.locator("#activity-update-activity").selectOption({ index: 1 });
  await page.locator("#activity-update-minutes").fill("25");
  await page.locator("#activity-update-reason").fill("تأخر العرض 25 دقيقة");
  await page.getByRole("button", { name: "راجع التحديث" }).click();
  await page.getByRole("button", { name: "انشر التحديث" }).click();
  await page.getByRole("button", { name: "سحب التحديث", exact: true }).first().click({ timeout: 20_000 });
  const revoke = page.getByRole("dialog", { name: "تأكيد سحب التحديث" });
  await expect(revoke).toBeVisible();
  await revoke.getByLabel(/سبب السحب/).fill("اختبار واجهة الإدارة");
  await revoke.getByRole("button", { name: "تأكيد السحب", exact: true }).click();
  await expect(revoke).toBeHidden();
  await expect(page.getByText(/تم سحب التحديث وحفظ الإجراء/)).toBeVisible();
  await expectResponsive(page);
});

test("the voice dialog returns visitors to typing on a short phone", async ({ page }) => {
  await page.setViewportSize(widths[2]);
  // /demo stays as the rehearsal alias of the default event.
  await buildItinerary(page, "/demo");
  await navTab(page, "ونيس").click();
  await page.getByRole("button", { name: "ابدأ محادثة صوتية مع ونيس" }).click();
  const call = page.getByRole("dialog", { name: "محادثة صوتية مع ونيس" });
  await expect(call).toBeInViewport();
  await call.getByRole("button", { name: "كمّل بالكتابة" }).click();
  await expect(call).toBeHidden();
  await expect(page.getByRole("textbox", { name: "اكتب طلبك" })).toBeFocused();
  await expectResponsive(page);
});
