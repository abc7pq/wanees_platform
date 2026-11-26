import { expect, test } from "@playwright/test";

// The app shell (audit 2.1–2.3, 3.2, 3.7): real URLs per screen, a bottom navigation on a 375 px phone,
// Back that moves between screens and closes sheets, «حولي» with «دلّني», and «أنا».
const visitor = process.env.WANEES_BASE_URL ?? "http://127.0.0.1:3100";
const base = "/e/boulevard-world-demo";

function nav(page) {
  return page.getByRole("navigation", { name: "التنقل الرئيسي" });
}
function navTab(page, name) {
  return nav(page).getByRole("button", { name: new RegExp(`^${name}`) });
}

async function startVisit(page, query = "") {
  await page.goto(`${visitor}${base}${query}`);
  await page.getByRole("textbox", { name: "قل لي وش بالك" }).fill("طلعة شباب، عندنا ساعتين");
  await page.getByRole("button", { name: /^يلا/ }).click();
  await expect(page.getByRole("heading", { name: "مسارك الليلة" })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route("https://server.arcgisonline.com/**", (route) => route.abort());
});

test("after the first message the visitor lands on «مساري», and each tab has its own URL", async ({ page }) => {
  await startVisit(page);
  await expect(page).toHaveURL(new RegExp(`${base}/plan$`));
  await expect(nav(page)).toBeVisible();
  await expect(nav(page).getByRole("button")).toHaveCount(5);
  await expect(navTab(page, "مساري")).toHaveAttribute("aria-current", "page");
  // The navigation sits at the bottom of the phone screen.
  const box = await nav(page).boundingBox();
  expect(box && box.y + box.height).toBeGreaterThan(800);

  await navTab(page, "حولي").click();
  await expect(page).toHaveURL(new RegExp(`${base}/nearby$`));
  await expect(navTab(page, "حولي")).toHaveAttribute("aria-current", "page");
  await navTab(page, "أنا").click();
  await expect(page.getByRole("heading", { name: "اللي فهمته عنك" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${base}/me$`));

  // Back moves between screens instead of leaving the app.
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${base}/nearby$`));
  await expect(navTab(page, "حولي")).toHaveAttribute("aria-current", "page");

  // A deep link opens the right screen on a returning visit.
  await page.goto(`${visitor}${base}/me`);
  await expect(page.getByRole("heading", { name: "اللي فهمته عنك" })).toBeVisible();
  await expect(navTab(page, "أنا")).toHaveAttribute("aria-current", "page");
});

test("Back closes a sheet and keeps the visitor on the screen", async ({ page }) => {
  await startVisit(page);
  await page.getByRole("button", { name: "زيارة جديدة" }).click();
  const sheet = page.getByRole("dialog", { name: "إنهاء الزيارة وحذف بياناتها؟" });
  await expect(sheet).toBeVisible();
  await page.goBack();
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`${base}/plan$`));
  await expect(page.getByRole("heading", { name: "مسارك الليلة" })).toBeVisible();
  // Escape still closes it, and focus returns to the button that opened it.
  const opener = page.getByRole("button", { name: "زيارة جديدة" });
  await opener.click();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(opener).toBeFocused();
});

test("«حولي» lists the nearest toilets from a simulated position, each with «دلّني»", async ({ page }) => {
  // Staff/demo mode (audit 3.7): ?gps=simulate&at=<node> stands the visitor at a walkway node.
  const node = await page.request.get(`${visitor}/api/events/boulevard-world-demo`).then((response) => response.json())
    .then((payload) => payload.data.catalog.routeGraph.nodes.find((candidate) => candidate.status === "open" && candidate.zone === "africa"));
  test.skip(!node, "the seeded walkway graph has no open node in Africa");
  await startVisit(page, `?gps=simulate&at=${encodeURIComponent(node.id)}`);
  await navTab(page, "حولي").click();
  await page.getByRole("button", { name: /دورات المياه/ }).click();
  const results = page.locator(".nearby-results li");
  await expect(results.first()).toBeVisible();
  await expect(page.locator(".nearby-origin")).toContainText("من مكانك الحين");
  await expect(results.first()).toContainText("أفريقيا");
  await expect(results.first().getByRole("button", { name: "دلّني" })).toBeVisible();
  expect(await results.count()).toBeLessThanOrEqual(3);
});

test("«أنا» changes the reply language with an undo", async ({ page }) => {
  await startVisit(page);
  await navTab(page, "أنا").click();
  const english = page.getByRole("radio", { name: "English" });
  await english.click();
  await expect(english).toHaveAttribute("aria-checked", "true");
  const toast = page.locator(".toast");
  await expect(toast).toContainText("Wanees will reply");
  await toast.getByRole("button", { name: "تراجع" }).click();
  await expect(page.getByRole("radio", { name: "العربية" })).toHaveAttribute("aria-checked", "true");
});

test("/events/{slug} moves to the canonical /e/{slug} address", async ({ page }) => {
  await page.goto(`${visitor}/events/boulevard-world-demo?nudge=test`);
  await expect(page).toHaveURL(new RegExp(`${base}\\?nudge=test$`));
});

test("«تذكّرني» is opt-in, and a returning guest starts the same mood in one tap", async ({ page, context }) => {
  await startVisit(page);
  await navTab(page, "ونيس").click();
  // Asked once in the chat after the first plan; nothing is remembered until the visitor says yes.
  await page.getByRole("button", { name: "إيه، تذكّرني" }).click();
  await expect(page.locator(".toast")).toContainText("أتذكرك المرة الجاية");
  await expect(page.getByRole("button", { name: "إيه، تذكّرني" })).toHaveCount(0);
  await navTab(page, "أنا").click();
  await expect(page.getByRole("checkbox", { name: /تذكّرني للزيارة الجاية/ })).toBeChecked();

  // A new visit on the same phone: the visit cookie is gone, the anonymous guest cookie stays.
  const keep = (await context.cookies()).filter((item) => item.name !== "wanees_visitor_session");
  await context.clearCookies();
  await context.addCookies(keep);
  await page.goto(`${visitor}${base}`);
  await expect(page.getByText("هلا فيك من جديد!")).toBeVisible();
  await page.getByRole("button", { name: "إيه، نفس الجو" }).click();
  await expect(page.getByRole("heading", { name: "مسارك الليلة" })).toBeVisible();
  await navTab(page, "أنا").click();
  const remember = page.getByRole("checkbox", { name: /تذكّرني للزيارة الجاية/ });
  await expect(remember).toBeChecked();
  await expect(page.getByText("هذي زيارتك رقم 2.")).toBeVisible();

  // Unticking forgets the guest; the visit itself goes on.
  await remember.uncheck();
  await expect(page.locator(".toast")).toContainText("ما عاد أتذكرك");
  await expect(remember).not.toBeChecked();
  expect((await context.cookies()).some((item) => item.name === "wanees_guest")).toBe(false);
});
