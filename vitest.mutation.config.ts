import { defineConfig } from "vitest/config";

// The mutation run (stryker.config.json): only the domain's own tests, which need no database,
// so Stryker's first full run stays inside its time limit on a small CI machine.
export default defineConfig({
  test: {
    name: "domain",
    environment: "node",
    include: ["src/domain/**/*.test.ts"],
    env: { APP_ENV: "test" },
  },
});
