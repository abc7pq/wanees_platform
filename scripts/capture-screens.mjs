// Captures README screenshots from a seeded loopback stack (visitor :3100, admin :3200).
// Usage: WANEES_OWNER_PASSWORD=... ADMIN_TOKEN=... node scripts/capture-screens.mjs [outDir]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const visitor = process.env.WANEES_BASE_URL ?? "http://127.0.0.1:3100";
const admin = process.env.WANEES_ADMIN_BASE_URL ?? "http://127.0.0.1:3200";
const out = process.argv[2] ?? "docs/screenshots";
const slug = "boulevard-world-demo";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ar-SA" });
const page = await phone.newPage();
const shot = (name, target = page) => target.screenshot({ path: `${out}/${name}.png` });

await page.goto(visitor);
await page.waitForLoadState("networkidle");
await shot("01-home");

await page.goto(`${visitor}/demo`);
await page.getByRole("button", { name: "ابدأ مساري" }).click();
await page.getByRole("heading", { name: "مين معك الليلة؟" }).waitFor();
await shot("02-questions");
await page.getByRole("button", { name: "عائلة وأطفال" }).click();
await page.locator(".tiles button").first().click();
await page.getByRole("button", { name: "100 – 300 ريال" }).click();
for (const interest of ["عائلة", "طبيعة"]) await page.getByRole("button", { name: new RegExp(interest) }).first().click();
await page.getByRole("button", { name: /هذا هو ذوقي/ }).click();
await page.getByRole("button", { name: "3 ساعات" }).click();
await page.getByRole("button", { name: "ابنِ مساري" }).click();
await page.getByRole("heading", { name: "مسارك الليلة" }).waitFor();
await page.waitForTimeout(800);
await shot("03-plan-next-step");

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
    payload: { minutes: 25, reason: `تأخر ${target.name} ٢٥ دقيقة` },
  }),
});
const update = (await response.json()).data?.update;
await page.getByRole("dialog", { name: /اقتراح تعديل المسار/ }).waitFor({ timeout: 60_000 });
await page.waitForTimeout(500);
await shot("04-change-proposal");
await page.getByRole("button", { name: "اعتمد البديل" }).click();
await page.waitForTimeout(800);

await page.getByRole("tab", { name: "المساعد" }).click();
await page.getByRole("textbox", { name: "اكتب طلبك" }).fill("وش أبدأ فيه مع عيالي؟");
await page.keyboard.press("Enter");
await page.waitForTimeout(6000);
await shot("05-assistant");

const desk = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: "ar-SA" });
const ops = await desk.newPage();
await ops.goto(`${visitor}/ops`);
await ops.waitForTimeout(2500);
await shot("06-ops-dashboard", ops);

await ops.goto(`${admin}/login`);
await ops.getByLabel(/البريد الإلكتروني/).pressSequentially("owner@wanees.demo");
await ops.getByLabel("كلمة المرور").pressSequentially(process.env.WANEES_OWNER_PASSWORD ?? "");
await ops.getByRole("button", { name: "دخول", exact: true }).click();
await ops.getByRole("heading", { name: "لوحة إدارة ونيس" }).waitFor();
await ops.locator("#dashboard-event").selectOption(slug).catch(() => {});
await ops.waitForTimeout(1500);
await shot("07-organizer", ops);

if (update?.id) {
  await fetch(`${admin}/api/v1/events/${slug}/updates/${update.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", origin: admin, "x-admin-token": process.env.ADMIN_TOKEN ?? "" },
    body: JSON.stringify({ action: "revoke", reason: "screenshots" }),
  });
}
await browser.close();
console.log(`screenshots written to ${out}`);
