import { defineConfig, devices } from "@playwright/test";

// Another checkout on the same machine may hold the default port.
const appPort = Number(process.env.E2E_PORT ?? "8787");
const stubPort = Number(process.env.MODEL_STUB_PORT ?? "8790");
const e2eDatabase = process.env.E2E_DATABASE_URL ?? "postgres://localhost:5432/respon_e2e";
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
      // A fresh test database each run, migrated and seeded, apart from the dev server's, and the
      // production build on Node. Files stay in memory, and the tests never call the model provider,
      // whatever .env holds: these settings win over its own.
      command: "pnpm db:e2e && pnpm build && pnpm start",
      url: `http://localhost:${appPort}/api/health`,
      env: {
        APP_ENV: "test",
        APP_ORIGIN: `http://localhost:${appPort}`,
        PORT: String(appPort),
        DATABASE_URL: e2eDatabase,
        IDENTITY_ADAPTER: "seeded",
        MODEL_MODE: "off",
        MODEL_API_KEY: "",
        S3_ENDPOINT: "",
      },
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
