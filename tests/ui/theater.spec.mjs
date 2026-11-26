import { expect, test } from "@playwright/test";

const visitor = process.env.WANEES_BASE_URL ?? "http://127.0.0.1:3100";

/** Arabic-Indic digits (and Arabic separators) to a JS number. */
function arabicNumber(text) {
  const western = String(text)
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/٬/g, "")
    .replace(/٫/g, ".")
    .replace(/[^\d.-]/g, "");
  return Number(western);
}

async function expectFitsViewport(page) {
  const sizes = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
  }));
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.width + 1);
}

async function liveValue(page, world, label) {
  const article = page.locator("article").filter({ has: page.getByRole("heading", { name: world, exact: true }) });
  const value = article.locator("dl > div").filter({ hasText: label }).locator("dd");
  return arabicNumber(await value.textContent());
}

async function summaryRow(page, label) {
  const row = page.locator("table tbody tr").filter({ hasText: label });
  const cells = row.locator("td");
  return { without: arabicNumber(await cells.nth(0).textContent()), with: arabicNumber(await cells.nth(1).textContent()) };
}

test("Crowd Theater tells the show-delay story on a phone", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${visitor}/ops/theater?adoption=40&accept=60&speed=4`);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "مسرح الحركة" })).toBeVisible();
  await expectFitsViewport(page);

  await page.getByRole("button", { name: "القصة كاملة بضغطة" }).click();
  const status = page.locator("p[aria-live=polite]");
  await expect(status).toContainText("شوف الفرق: بدون ونيس", { timeout: 90_000 });
  const waitingWithout = await liveValue(page, "بدون ونيس", "بانتظار العرض");
  const waitingWith = await liveValue(page, "مع ونيس", "بانتظار العرض");
  expect(waitingWithout).toBeGreaterThan(0);
  expect(waitingWith).toBeLessThan(waitingWithout);
  await expect(page.getByRole("button", { name: /نُشر التأخير/ })).toBeDisabled();

  await page.getByRole("button", { name: "كمّل" }).click();
  await expect(page.locator("table")).toBeVisible({ timeout: 90_000 });
  const peak = await summaryRow(page, "أكبر تجمّع واقف");
  expect(peak.with).toBeLessThan(peak.without);
  const attendance = await summaryRow(page, "حضروا");
  expect(attendance.with).toBe(attendance.without);
  await expectFitsViewport(page);
});

test("with nobody using WANEES the two worlds come out identical", async ({ page }) => {
  await page.goto(`${visitor}/ops/theater?adoption=0`);
  // Generous timeout: on a busy dev server hydration can take a while.
  await expect(page.getByRole("slider", { name: /زوار معهم ونيس/ })).toHaveValue("0", { timeout: 30_000 });
  await page.getByRole("button", { name: "النتيجة" }).click();
  const rows = page.locator("table tbody tr");
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  for (let index = 0; index < count; index += 1) {
    const cells = rows.nth(index).locator("td");
    expect(await cells.nth(1).textContent()).toBe(await cells.nth(0).textContent());
  }
});

test("Crowd Theater keeps settings in the link and survives a missing event", async ({ page }) => {
  await page.goto(`${visitor}/ops/theater?event=no-such-event&adoption=73&accept=20`);
  // The first request may wait for the dev server to compile the API route.
  await expect(page.getByText(/تعذّر تحميل الفعالية/)).toBeVisible({ timeout: 30_000 });
  // 73 snaps to the slider's 10% steps.
  await expect(page.getByRole("slider", { name: /زوار معهم ونيس/ })).toHaveValue("70", { timeout: 30_000 });
  await expect(page).toHaveURL(/adoption=70/);
  await expect(page).toHaveURL(/accept=20/);
  await page.getByRole("slider", { name: /يقبلون اقتراح البديل/ }).fill("90");
  await expect(page).toHaveURL(/accept=90/);
  await expect(page.getByRole("button", { name: "القصة كاملة بضغطة" })).toBeEnabled();
});

test("an operator picks the show and delay, and sees the adoption curve", async ({ page }) => {
  await page.goto(`${visitor}/ops/theater?show=india_show&delay=45&adoption=40`);
  const showPicker = page.getByRole("combobox", { name: "العرض" });
  const delayPicker = page.getByRole("combobox", { name: "مدة التأخير" });
  await expect(showPicker).toHaveValue("india_show", { timeout: 30_000 });
  await expect(delayPicker).toHaveValue("45");
  await expect(page).toHaveURL(/show=india_show/);

  await page.getByRole("slider", { name: "الوقت في الليلة" }).fill("60");
  await page.getByRole("button", { name: /انشر: تأخير/ }).click();
  await page.getByRole("button", { name: "إيقاف مؤقت" }).click();
  await expect(page.locator("p[aria-live=polite]")).toContainText("متأخر ٤٥ دقيقة");
  // The show and delay are fixed once the delay is published.
  await expect(showPicker).toBeDisabled();
  await expect(delayPicker).toBeDisabled();

  await page.getByRole("button", { name: "النتيجة" }).click();
  const impact = page.getByRole("region", { name: "لو زاد مستخدمو ونيس؟" });
  await expect(impact).toBeVisible({ timeout: 30_000 });
  await expect(impact.getByText(/كل ١٠٪ زيادة في المستخدمين/)).toBeVisible({ timeout: 30_000 });
  await expect(impact.getByRole("img")).toBeVisible();
  await expect(impact.getByText(/عند ٤٠٪ \(اختيارك الحالي\)/)).toBeVisible();
});

test("a hanging event API falls back to the demo catalog instead of loading forever", async ({ page }) => {
  // Never answer the catalog request.
  await page.route("**/api/events/**", () => {});
  await page.goto(`${visitor}/ops/theater?event=boulevard-world-demo`);
  await expect(page.getByText("جارٍ تحميل كتالوج الفعالية…")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/تعذّر تحميل الفعالية «boulevard-world-demo»/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "القصة كاملة بضغطة" })).toBeEnabled();
});
