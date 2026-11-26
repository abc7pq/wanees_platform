import { expect, test } from "@playwright/test";

// The visitor app behaves like a phone app: the visit starts with one sentence (no questionnaire),
// the first screen fits a small phone, every stop has a ⋯ menu in a bottom sheet that the phone's
// Back button closes, and no screen scrolls sideways.
const visitor = process.env.WANEES_BASE_URL ?? "http://127.0.0.1:3100";
const nav = (page) => page.getByRole("navigation", { name: "التنقل الرئيسي" });

async function sideways(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test("a small phone opens on a chat, with no questionnaire, and the message box above the fold", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(`${visitor}/e/boulevard-world-demo`);
  const box = page.getByRole("textbox", { name: "قل لي وش بالك" });
  await expect(box).toBeEnabled();
  for (const question of ["مين معك الليلة؟", "وش مزاجك الليلة؟", "ميزانيتك الليلة؟", "كم بنقعد؟"]) {
    await expect(page.getByText(question)).toHaveCount(0);
  }
  await box.fill("معي عيالي");
  const send = page.getByRole("button", { name: /^يلا/ });
  const sendBox = await send.boundingBox();
  expect(sendBox && sendBox.y + sendBox.height).toBeLessThanOrEqual(740);
  // Like a messaging app, the message box is docked to the bottom of the screen.
  const composer = await page.getByRole("form", { name: "ابدأ الكلام مع ونيس" }).boundingBox();
  expect(Math.abs(composer.y + composer.height - 740)).toBeLessThanOrEqual(2);
  expect(await sideways(page)).toBeLessThanOrEqual(0);
});

test("every stop has a ⋯ menu; Back closes it and «ليش هذي المحطة؟» asks Wanees", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("https://server.arcgisonline.com/**", (route) => route.abort());
  await page.goto(`${visitor}/e/boulevard-world-demo`);
  await page.getByRole("textbox", { name: "قل لي وش بالك" }).fill("طلعة شباب، عندنا ساعتين");
  await page.getByRole("button", { name: /^يلا/ }).click();
  await expect(page.getByRole("heading", { name: "مسارك الليلة" })).toBeVisible();

  const more = page.getByRole("button", { name: /^خيارات / });
  expect(await more.count()).toBeGreaterThan(1);
  const stopName = (await more.last().getAttribute("aria-label")).replace(/^خيارات /, "");
  await more.last().click();
  const sheet = page.getByRole("dialog", { name: stopName });
  await expect(sheet).toBeVisible();
  for (const action of ["اعرضها على الخريطة", "ليش هذي المحطة؟", "بدّلها بشي ثاني", "شيلها من مساري", "شارك المحطة"]) {
    await expect(sheet.getByRole("button", { name: action })).toBeVisible();
  }

  // The phone's Back button closes the sheet and stays in the app.
  await page.goBack();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("heading", { name: "مسارك الليلة" })).toBeVisible();

  await more.last().click();
  await sheet.getByRole("button", { name: "ليش هذي المحطة؟" }).click();
  await expect(sheet).toBeHidden();
  await expect(nav(page).getByRole("button", { name: /^ونيس/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(`ليش اخترت ${stopName}؟`)).toBeVisible();

  for (const tab of ["مساري", "الخريطة", "ونيس", "حولي", "أنا"]) {
    await nav(page).getByRole("button", { name: new RegExp(`^${tab}`) }).click();
    expect(await sideways(page), tab).toBeLessThanOrEqual(0);
  }
});
