import { expect, test } from "@playwright/test";

const visitor = process.env.WANEES_BASE_URL ?? "http://127.0.0.1:3100";
const event = "boulevard-world-demo";

async function expectFitsViewport(page) {
  const sizes = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
  }));
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.width + 1);
}

/** A live venue: open at 18:00, the lagoon packed (measured), an operator delay and a closure. */
async function mockOpenVenue(page) {
  const clock = { nowMinute: 1080, actualMinute: 1080, isOpen: true, isWithinEvent: true };
  await page.route(`**/api/v1/events/${event}/crowd`, (route) => route.fulfill({
    json: {
      data: {
        clock,
        threshold: 0.75,
        zones: [
          { zone: "lagoon", level: 0.9, source: "sensor", quietestUpcomingHour: 22 },
          { zone: "planet", level: 0.6, source: "sensor" },
          { zone: "france", level: 0.1, source: "sensor" },
        ],
      },
    },
  }));
  await page.route(`**/api/v1/events/${event}/live`, (route) => route.fulfill({
    json: {
      data: {
        clock,
        updates: [
          { updateType: "DELAY", targetType: "activity", targetId: "dolphinarium", payload: { minutes: 25, reason: "صيانة سريعة للمسرح" } },
          { updateType: "CLOSURE", targetType: "zone", targetId: "spain", payload: {} },
        ],
      },
    },
  }));
}

test("the live board shows quiet zones, delayed shows and operator notices on a phone and a wall screen", async ({ page }) => {
  await mockOpenVenue(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${visitor}/board/${event}`);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByText("مباشر", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("١٨:٠٠").first()).toBeVisible();

  const notices = page.getByRole("region", { name: "تنبيهات إدارة الموقع" });
  await expect(notices.getByText("تأخير ٢٥ دقيقة: عرض الدولفيناريوم")).toBeVisible();
  await expect(notices.getByText("صيانة سريعة للمسرح")).toBeVisible();
  await expect(notices.getByText(/إغلاق مؤقت: منطقة إسبانيا/)).toBeVisible();

  const shows = page.getByRole("region", { name: "العروض الجاية" });
  const dolphins = shows.getByRole("listitem").filter({ hasText: "عرض الدولفيناريوم" }).first();
  await expect(dolphins).toContainText("متأخر ٢٥ د");
  await expect(dolphins).toContainText("١٨:٥٥");
  // The closed zone's show is marked cancelled, not silently dropped.
  await expect(shows.getByRole("listitem").filter({ hasText: "عروض إسبانيا المتجولة" }).first()).toContainText("ملغي");

  const quiet = page.getByRole("region", { name: "الأهدأ الحين" });
  await expect(quiet.getByRole("listitem")).toHaveCount(3);
  await expect(quiet).not.toContainText("البحيرة المركزية");
  await expect(quiet).not.toContainText("منطقة إسبانيا");

  const zones = page.getByRole("region", { name: "زحام المناطق" });
  await expect(zones.getByRole("img", { name: /البحيرة المركزية: ٩٠٪ \(مقاس\)/ })).toBeVisible();
  await expect(zones.getByText(/أهدأ الساعة ٢٢/)).toBeVisible();
  await expect(zones.getByRole("img", { name: "منطقة إسبانيا: مغلقة" })).toBeVisible();
  await expect(page.getByText(/قراءات الزحام تقديرية/)).toHaveCount(0);
  await expectFitsViewport(page);

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`${visitor}/board/${event}?tv=1`);
  await expect(page.getByText("مباشر", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expectFitsViewport(page);
});

test("a closed venue never claims to be live", async ({ page }) => {
  const clock = { nowMinute: 1020, actualMinute: 610, isOpen: false, isWithinEvent: true };
  await page.route(`**/api/v1/events/${event}/crowd`, (route) => route.fulfill({ json: { data: { clock, threshold: 0.75, zones: [] } } }));
  await page.route(`**/api/v1/events/${event}/live`, (route) => route.fulfill({ json: { data: { clock, updates: [] } } }));
  await page.goto(`${visitor}/board/${event}`);
  await expect(page.getByText(/مغلق الحين · يفتح ١٧:٠٠/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("مباشر", { exact: true })).toHaveCount(0);
  // The wall clock shows the real local time (10:10), not the opening time the planner uses.
  await expect(page.getByText("١٠:١٠", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "عروض الليلة" })).toBeVisible();
  await expect(page.getByText(/قراءات الزحام تقديرية، ليست من حساسات/)).toBeVisible();
});

test("the board keeps the last reading and says so when updates fail", async ({ page }) => {
  await page.clock.install();
  await mockOpenVenue(page);
  await page.goto(`${visitor}/board/${event}`);
  await expect(page.getByText("مباشر", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.route(`**/api/v1/events/${event}/**`, (route) => route.abort());
  await page.clock.fastForward("01:30");
  await expect(page.getByText(/تعذّر التحديث. نعرض آخر قراءة/)).toBeVisible({ timeout: 15_000 });
  // The last good reading stays on screen.
  await expect(page.getByText("تأخير ٢٥ دقيقة: عرض الدولفيناريوم")).toBeVisible();
});

test("a board whose first load fails recovers well before the next normal poll", async ({ page }) => {
  await mockOpenVenue(page);
  let failuresLeft = 1;
  await page.route(`**/api/v1/events/${event}/crowd`, async (route) => {
    if (failuresLeft > 0) {
      failuresLeft -= 1;
      await route.abort();
      return;
    }
    await route.fallback();
  });
  await page.goto(`${visitor}/board/${event}`);
  await expect(page.getByText(/تعذّر تحميل حالة الموقع/)).toBeVisible({ timeout: 30_000 });
  // The normal poll is 15 seconds; a failed load retries within a few.
  await expect(page.getByText("مباشر", { exact: true })).toBeVisible({ timeout: 8_000 });
});

test("an unknown event gets a clear message", async ({ page }) => {
  await page.goto(`${visitor}/board/no-such-event`);
  // Scoped to main: Next.js adds its own (empty) role="alert" route announcer.
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("ما لقينا فعالية منشورة بهذا الرابط.", { timeout: 30_000 });
});
