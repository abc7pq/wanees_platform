import { expect, test } from "@playwright/test";

// Live walking guidance (audit item 0.2): with the venue's live guidance on, a phone whose GPS is
// inside Boulevard World gets the live AirTag-style guide, not the simulated walk.
const visitor = process.env.WANEES_BASE_URL ?? "http://127.0.0.1:3100";

/** Plan point → GPS with the seeded Boulevard World calibration (Venue.geoAnchorLat/Lng, 0.62 m/unit). */
function planToGps(x, y) {
  const anchor = { lat: 24.7766539, lng: 46.6003677 };
  const metersPerUnit = 0.62;
  return {
    latitude: anchor.lat - (y * metersPerUnit) / 110_574,
    longitude: anchor.lng + (x * metersPerUnit) / (111_320 * Math.cos((anchor.lat * Math.PI) / 180)),
  };
}

function navTab(page, name) {
  return page.getByRole("navigation", { name: "التنقل الرئيسي" }).getByRole("button", { name: new RegExp(`^${name}`) });
}

async function buildItinerary(page) {
  await page.goto(`${visitor}/e/boulevard-world-demo`);
  // Audit 1.1: no quiz. One sentence starts the visit and the plan appears.
  await page.getByRole("textbox", { name: "قل لي وش بالك" }).fill("طلعة شباب، عندنا ساعتين");
  await page.getByRole("button", { name: /^يلا/ }).click();
  await expect(page.getByRole("heading", { name: "مسارك الليلة" })).toBeVisible();
}

test("inside the venue, «دلّني» opens the live guide from the phone's GPS", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("https://server.arcgisonline.com/**", (route) => route.abort());
  await context.grantPermissions(["geolocation"], { origin: new URL(visitor).origin });
  // Standing in the Saudi zone, far from the first stop, with a crowd-grade 30 m fix.
  await context.setGeolocation({ ...planToGps(-115, 479), accuracy: 30 });
  await buildItinerary(page);
  await navTab(page, "ونيس").click();
  await page.getByRole("button", { name: /ضعت! دلّني/ }).click();
  const guide = page.getByRole("dialog", { name: /^التوجيه إلى/ });
  await expect(guide).toBeVisible();
  await expect(guide).not.toContainText("محاكاة مشي");
  await expect(guide).toContainText("جارٍ البحث");
  // Boulevard World is traced from imagery, so the guide asks the visitor to follow the signs too.
  await expect(guide.getByRole("note")).toHaveText("المسار تقريبي، اتبع لوحات الموقع أيضًا.");
  await guide.getByRole("button", { name: "إنهاء التوجيه" }).click();
  await expect(guide).toBeHidden();
});

test("outside the venue, the guide offers a simulated walk instead of a dead end", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("https://server.arcgisonline.com/**", (route) => route.abort());
  await context.grantPermissions(["geolocation"], { origin: new URL(visitor).origin });
  await context.setGeolocation({ latitude: 24.5, longitude: 46.6, accuracy: 10 });
  await buildItinerary(page);
  await navTab(page, "ونيس").click();
  await page.getByRole("button", { name: /ضعت! دلّني/ }).click();
  const directions = page.getByRole("dialog", { name: "اتجاهات المشي" });
  await expect(directions).toBeVisible();
  await expect(directions).toContainText("ما قدرنا نحدد موقعك داخل الفعالية");
});
