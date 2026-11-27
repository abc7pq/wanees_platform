import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/ui",
  testMatch: "**/*.spec.mjs",
  // Refuses to start unless WANEES_UI_DATABASE_URL names a throwaway database (tests/ui/db-guard.mjs).
  globalSetup: "./tests/ui/db-guard.mjs",
  timeout: 90_000,
  // Some steps wait on the server: building the first plan, or a route from a GPS fix. On a cold CI runner
  // with two browsers at once these took just over the default 5 s (WebKit app-shell.spec.mjs:27 on PR #20).
  expect: { timeout: 15_000 },
  workers: 2,
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    ignoreHTTPSErrors: process.env.WANEES_UI_LOCAL_CERT === "1",
    // The app's service worker (app/public/sw.js) calls skipWaiting + clients.claim, so it can take
    // control of the page mid-test. Once it does, WebKit sends the page's fetches through it and they
    // bypass page.route(): mocked crowd/live data is replaced by the real server's and route.abort()
    // stops working (the board.spec.mjs:94 WebKit failures). No UI test exercises the worker itself.
    serviceWorkers: "block",
  },
  projects: ["chromium", "firefox", "webkit"].map((browserName) => ({ name: browserName, use: { browserName } })),
});
