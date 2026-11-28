import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Tests read KEY_HMAC_SECRET from .env; CI sets it directly.
if (existsSync(".env")) process.loadEnvFile(".env");
process.env.APP_ENV = "test";

export default defineConfig({
  test: {
    env: { APP_ENV: "test", KEY_HMAC_SECRET: process.env.KEY_HMAC_SECRET ?? "" },
    projects: [
      {
        test: {
          name: "server",
          environment: "node",
          include: ["src/**/*.test.ts", "db/**/*.test.ts"],
          // Each file gets its own Postgres database, copied from a template migrated and seeded once
          // per run. Under a full parallel run a test gets more time than the default.
          globalSetup: ["db/testTemplate.ts"],
          setupFiles: ["db/testDatabase.ts"],
          testTimeout: 20_000,
        },
      },
      {
        esbuild: { jsx: "automatic" },
        test: {
          name: "app",
          environment: "jsdom",
          include: ["app/**/*.test.{ts,tsx}"],
          setupFiles: ["app/testing/setup.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}", "app/**/*.{ts,tsx}", "tools/reference-import/{read,snapshot,file}.ts"],
      // Entry shells with no logic of their own; the end-to-end suite runs them.
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/*.d.ts",
        "app/root.tsx",
        "app/routes.ts",
        "app/entry.server.tsx",
        "app/testing/**",
        "src/platform/node/**",
        // Test fixtures and helpers; the tests that use them are what is measured.
        "src/testing/**",
        "src/contract/samples.ts",
      ],
      thresholds: { lines: 100, statements: 100, branches: 100, functions: 100 },
      reporter: ["text-summary", "html"],
      reportsDirectory: "coverage",
    },
  },
});
