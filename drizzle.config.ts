import { defineConfig } from "drizzle-kit";

// `pnpm db:generate` writes a new migration from db/schema.ts into db/migrations. Commit it; the
// server applies it when it starts.
export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
});
