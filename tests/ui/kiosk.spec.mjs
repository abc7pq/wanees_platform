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
