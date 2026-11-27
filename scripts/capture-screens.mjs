// Captures every README screenshot from a seeded loopback stack (visitor :3100, admin :3200).
// Usage: WANEES_OWNER_PASSWORD=... ADMIN_TOKEN=... node scripts/capture-screens.mjs [outDir]
// Phone shots are 390 × 844 at 2×, so they line up in the README; the two desk shots are 1360 wide.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const visitor = process.env.WANEES_BASE_URL ?? "http://127.0.0.1:3100";
const admin = process.env.WANEES_ADMIN_BASE_URL ?? "http://127.0.0.1:3200";
const out = process.argv[2] ?? "docs/screenshots";
const slug = "boulevard-world-demo";
const sentence = "معي عيالي، ولدي عمره 6 ويحب الطيران";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const phoneContext = (options = {}) => browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, locale: "ar-SA", ...options });
const shot = (target, name) => target.screenshot({ path: `${out}/${name}.png` });
const settle = (target, ms = 700) => target.waitForTimeout(ms);
// The satellite tiles are an outside service; the illustrated map is what the README shows.
const offlineTiles = (target) => target.route("https://server.arcgisonline.com/**", (route) => route.abort());

async function startVisit(page) {
  await page.goto(`${visitor}/e/${slug}`);
  await page.getByRole("textbox", { name: "قل لي وش بالك" }).fill(sentence);
  await page.getByRole("button", { name: /^يلا/ }).click();
  await page.getByRole("heading", { name: "مسارك الليلة" }).waitFor();
  await settle(page, 900);
}

const phone = await phoneContext();
const page = await phone.newPage();
await offlineTiles(page);

await page.goto(visitor);
await page.waitForLoadState("networkidle");
await shot(page, "01-home");

// One sentence instead of a questionnaire.
await page.goto(`${visitor}/e/${slug}`);
await page.getByRole("textbox", { name: "قل لي وش بالك" }).waitFor();
await settle(page, 500);
await shot(page, "02-talk");

await startVisit(page);
await shot(page, "03-plan-next-step");

// Every stop has a ⋯ menu in a bottom sheet.
await page.getByRole("button", { name: /^خيارات / }).nth(1).click();
await settle(page);
await shot(page, "08-stop-menu");
await page.keyboard.press("Escape");
await settle(page, 400);

// The operator delays the visitor's next stop; WANEES proposes and waits for consent.
const plan = await page.evaluate(async (eventSlug) => (await (await fetch(`/api/v1/events/${eventSlug}/itinerary`, { credentials: "include" })).json()).data, slug);
const live = await page.evaluate(async (eventSlug) => (await (await fetch(`/api/v1/events/${eventSlug}/live`, { credentials: "include" })).json()).data, slug);
const target = plan.itinerary.stops.find((stop) => stop.start > (live.clock?.nowMinute ?? 0)) ?? plan.itinerary.stops[0];
const response = await fetch(`${admin}/api/v1/events/${slug}/updates`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: admin, "x-admin-token": process.env.ADMIN_TOKEN ?? "", "idempotency-key": `screens-${Date.now()}` },
  body: JSON.stringify({
    updateType: "DELAY", targetType: "activity", targetId: target.act_id,
    startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    payload: { minutes: 25, reason: `تأخر ${target.name} 25 دقيقة` },
  }),
});
const update = (await response.json()).data?.update;
await page.getByRole("dialog", { name: /اقتراح تعديل المسار/ }).waitFor({ timeout: 60_000 });
await settle(page, 500);
await shot(page, "04-change-proposal");
await page.getByRole("button", { name: "اعتمد البديل" }).click();
await settle(page, 800);

await page.getByRole("navigation", { name: "التنقل الرئيسي" }).getByRole("button", { name: /^ونيس/ }).click();
await page.getByRole("textbox", { name: "اكتب طلبك" }).fill("وش أبدأ فيه مع عيالي؟");
await page.keyboard.press("Enter");
await page.waitForTimeout(6000);
await shot(page, "05-assistant");
await phone.close();

// Night purple from the identity guide.
const night = await phoneContext({ colorScheme: "dark" });
const nightPage = await night.newPage();
await offlineTiles(nightPage);
await startVisit(nightPage);
await shot(nightPage, "09-dark");
await night.close();

// Late in the evening, after the last stop: «كيف كانت ليلتك مع ونيس؟» with the five faces from the emoji sheet.
const closing = await phoneContext();
const closingPage = await closing.newPage();
await offlineTiles(closingPage);
await closingPage.route("**/api/v1/events/*/live", async (route) => {
  const live = await route.fetch();
  const body = await live.json();
  body.data.clock = { ...body.data.clock, isOpen: true, nowMinute: 1380 };
  await route.fulfill({ response: live, json: body });
});
await startVisit(closingPage);
const rating = closingPage.getByRole("group", { name: "كيف كانت ليلتك مع ونيس؟" });
await rating.waitFor();
await rating.evaluate((element) => element.scrollIntoView({ block: "center" }));
await settle(closingPage);
await shot(closingPage, "10-rating");
await closing.close();

const desk = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: "ar-SA" });
const ops = await desk.newPage();
await ops.goto(`${visitor}/ops`);
await ops.waitForTimeout(2500);
await shot(ops, "06-ops-dashboard");

await ops.goto(`${admin}/login`);
// Scope to the form: the local demo-credentials panel has copy buttons labelled with the same words.
const loginForm = ops.locator("form");
await loginForm.getByLabel(/البريد الإلكتروني/).pressSequentially("owner@wanees.demo");
await loginForm.getByLabel("كلمة المرور").pressSequentially(process.env.WANEES_OWNER_PASSWORD ?? "");
await ops.getByRole("button", { name: "دخول", exact: true }).click();
await ops.getByRole("heading", { name: "لوحة إدارة ونيس" }).waitFor();
await ops.locator("#dashboard-event").selectOption(slug).catch(() => {});
await ops.waitForTimeout(1500);
await shot(ops, "07-organizer");

if (update?.id) {
  await fetch(`${admin}/api/v1/events/${slug}/updates/${update.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", origin: admin, "x-admin-token": process.env.ADMIN_TOKEN ?? "" },
    body: JSON.stringify({ action: "revoke", reason: "screenshots" }),
  });
}
await browser.close();
console.log(`screenshots written to ${out}`);
