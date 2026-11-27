import { expect, request as playwrightRequest, test } from "@playwright/test";

// The kiosk test page (audit 5.2): a registered screen answers from its own node with large targets,
// and «انتهيت» forgets the visit. Without a device token the page only points to the phone app.
const visitor = process.env.WANEES_BASE_URL ?? "http://127.0.0.1:3100";
const admin = process.env.WANEES_ADMIN_BASE_URL ?? "http://127.0.0.1:3200";
const slug = "boulevard-world-demo";

async function registerKiosk() {
  const password = process.env.WANEES_OWNER_PASSWORD;
  if (!password) throw new Error("Set WANEES_OWNER_PASSWORD to the seeded test organizer password.");
  const api = await playwrightRequest.newContext({ baseURL: admin, extraHTTPHeaders: { origin: admin } });
  const login = await api.post("/api/login", { data: { email: "owner@wanees.demo", password } });
  expect(login.ok()).toBeTruthy();
  const event = await (await playwrightRequest.newContext()).get(`${visitor}/api/events/${slug}`);
  const nodes = (await event.json()).data.catalog.routeGraph.nodes;
  const node = nodes.find((item) => item.status === "open" && item.zone === "africa");
  const created = await api.post(`/api/v1/events/${slug}/kiosks`, { data: { name: "شاشة اختبار الواجهة", nodeKey: node.id } });
  expect(created.status()).toBe(201);
  const body = await created.json();
  return { api, id: body.data.id, token: body.data.token };
}

test("a kiosk answers from its own spot, with large targets, and forgets on «انتهيت»", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const kiosk = await registerKiosk();
  try {
    await page.goto(`${visitor}/kiosk/${slug}#kiosk=${kiosk.token}`);
    await expect(page.getByRole("heading", { name: "اسأل ونيس" })).toBeVisible();
    // The device token does not stay in the address bar.
    await expect(page).toHaveURL(new RegExp(`/kiosk/${slug}$`));
    const quick = page.getByRole("button", { name: "وين أقرب دورة مياه؟" });
    expect((await quick.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(64);
    await quick.click();
    const reply = page.locator(".kiosk-reply");
    await expect(reply).toBeVisible();
    await expect(reply.locator("li").first()).toBeVisible();
    await page.getByRole("button", { name: "انتهيت" }).click();
    await expect(reply).toHaveCount(0);
  } finally {
    await kiosk.api.delete(`/api/v1/events/${slug}/kiosks/${kiosk.id}`);
  }
});

test("without a device token the kiosk page sends people to the phone app", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${visitor}/kiosk/${slug}`);
  await expect(page.getByRole("link", { name: "افتح ونيس" })).toHaveAttribute("href", `/e/${slug}`);
  await context.close();
});

test("an organizer adds a kiosk on a phone, opens it from the one-time link, and revokes it", async ({ page, browserName }) => {
  const password = process.env.WANEES_OWNER_PASSWORD;
  if (!password) throw new Error("Set WANEES_OWNER_PASSWORD to the seeded test organizer password.");
  const event = "sample-festival";
  const name = `شاشة ${browserName} ${Date.now().toString(36)}`;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${admin}/login`);
  await page.getByRole("textbox", { name: /البريد الإلكتروني/ }).pressSequentially("owner@wanees.demo");
  await page.getByRole("textbox", { name: "كلمة المرور", exact: true }).pressSequentially(password);
  await page.getByRole("button", { name: "دخول", exact: true }).click();
  await expect(page.getByRole("heading", { name: "لوحة إدارة ونيس" })).toBeVisible();

  await page.goto(`${admin}/events/${event}`);
  const panel = page.locator("section", { has: page.getByRole("heading", { name: "شاشات الاستعلام" }) });
  await expect(panel).toBeVisible();
  const add = panel.getByRole("button", { name: "إضافة شاشة" });
  await expect(add).toBeDisabled();
  await panel.getByLabel("اسم الشاشة").fill(name);
  const node = panel.getByLabel("مكانها على الممرات");
  const firstNode = await node.locator("option").nth(1).getAttribute("value");
  await node.selectOption(firstNode);
  await add.click();

  // The link is shown once, carries the token in the fragment, and the new screen is listed as active.
  const link = await panel.getByRole("textbox", { name: "رابط الشاشة" }).inputValue();
  expect(link).toMatch(new RegExp(`/kiosk/${event}#kiosk=wk_[A-Za-z0-9_-]{43}$`));
  const row = panel.getByRole("row", { name: new RegExp(name) });
  await expect(row.getByText("نشطة")).toBeVisible();
  const width = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.client + 1);

  // The link opens a working kiosk on another device.
  const screen = await page.context().browser().newContext();
  const kioskPage = await screen.newPage();
  const target = new URL(link);
  await kioskPage.goto(`${visitor}${target.pathname}${target.hash}`);
  await expect(kioskPage.getByRole("heading", { name: "اسأل ونيس" })).toBeVisible();
  await screen.close();

  page.once("dialog", (dialog) => dialog.accept());
  await row.getByRole("button", { name: "إيقاف" }).click();
  // Revoked screens leave the active list and wait, folded, under «الموقوفة».
  await expect(page.getByRole("row", { name: new RegExp(name) }).filter({ has: page.getByRole("button", { name: "إيقاف" }) })).toHaveCount(0);
  await panel.locator("summary", { hasText: "الموقوفة" }).click();
  await expect(panel.locator(".kiosk-revoked").getByRole("row", { name: new RegExp(name) }).getByText("موقوفة")).toBeVisible();
  await expect(panel.getByRole("textbox", { name: "رابط الشاشة" })).toHaveCount(0);
});
