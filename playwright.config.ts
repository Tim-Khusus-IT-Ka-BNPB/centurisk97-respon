import { defineConfig, devices } from "@playwright/test";

// Another checkout on the same machine may hold the default port.
const appPort = Number(process.env.E2E_PORT ?? "8787");
const stubPort = Number(process.env.MODEL_STUB_PORT ?? "8790");
const gatewayPort = Number(process.env.TEST_GATEWAY_PORT ?? "8791");
// Made for this run alone, and good for nothing else.
const gatewaySecret = "browser-tests-gateway-secret-32-bytes-long";
const ci = Boolean(process.env.CI);
const phone = { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } };

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: ci,
  retries: 0,
  // CI prints each failure as it happens, so a run cut off by its time limit still shows why.
  reporter: ci ? [["line"]] : [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: `http://localhost:${appPort}`,
    // A click that cannot land fails with its reason instead of running out the test's time.
    actionTimeout: 30_000,
    // Traces and videos record typed names and numbers, so CI never keeps them.
    trace: ci ? "off" : "retain-on-failure",
    video: "off",
    screenshot: "off",
  },
  projects: [
    { name: "chromium", use: { ...phone } },
    { name: "webkit", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } },
    { name: "chromium-320", use: { ...phone, viewport: { width: 320, height: 640 } } },
    { name: "chromium-tablet", use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } } },
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "webkit-desktop", use: { ...devices["Desktop Safari"], viewport: { width: 1920, height: 1080 } } },
    { name: "chromium-no-script", use: { ...phone, javaScriptEnabled: false } },
    {
      name: "webkit-no-script",
      use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 }, javaScriptEnabled: false },
    },
  ],
  webServer: [
    {
      command: "pnpm model-stub",
      url: `http://127.0.0.1:${stubPort}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      // A fresh test database each run, migrated and seeded, apart from the dev server's.
      // Tests never call the model provider, whatever .dev.vars holds.
      command: `pnpm db:e2e && pnpm preview --port ${appPort} --persist-to .wrangler/e2e --var APP_ENV:test --var APP_ORIGIN:http://localhost:${appPort} --var MODEL_MODE:off --var MODEL_API_KEY: --var GATEWAY_SECRETS:browser-tests=${gatewaySecret}`,
      url: `http://localhost:${appPort}/api/lapor/health`,
      env: { APP_ENV: "test" },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // What stands in for WhatsApp: a walk writes as a number and reads what that number receives.
      command: "pnpm test-gateway",
      url: `http://127.0.0.1:${gatewayPort}/health`,
      env: {
        TEST_GATEWAY_PORT: String(gatewayPort),
        TEST_GATEWAY_APP: `http://localhost:${appPort}`,
        TEST_GATEWAY_ID: "browser-tests",
        TEST_GATEWAY_SECRET: gatewaySecret,
        TEST_GATEWAY_PULL_MS: "1000",
      },
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
