import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll } from "vitest";
import { getPlatformProxy } from "wrangler";
import type { Database } from "../src/platform/database.ts";
import seedPlaces from "./seed/0001_places.ts";
import seedIdentities from "./seed/0002_identities.ts";
import seedReference from "./seed/0003_reference.ts";

// Each server test file gets its own in-memory D1 database: the migrations in order, then the
// seed. Statements end at a semicolon closing a line; a trigger body is kept on one line.
const MIGRATIONS = "db/migrations";

async function migrate(db: Database): Promise<void> {
  for (const name of (await readdir(MIGRATIONS)).filter((file) => file.endsWith(".sql")).sort()) {
    const text = await readFile(join(MIGRATIONS, name), "utf8");
    const statements = text
      .split(/;[ \t]*\r?\n/)
      .map((part) => part.replace(/^\s*--.*$/gm, "").trim())
      .filter((part) => part !== "");
    await db.batch(statements.map((statement) => db.prepare(statement.replace(/;$/, ""))));
  }
}

const proxy = await getPlatformProxy<{ DB: Database; MAIN_DB: Database; PHOTOS: unknown }>({
  configPath: "wrangler.jsonc",
  persist: false,
});
await migrate(proxy.env.DB);
await seedPlaces(proxy.env.DB);
await seedIdentities(proxy.env.DB);
await seedReference(proxy.env.DB);
(globalThis as { testD1?: Database }).testD1 = proxy.env.DB;
// An empty database standing for the main site's, for the upstream identity adapter.
(globalThis as { testMainD1?: Database }).testMainD1 = proxy.env.MAIN_DB;
// The R2 bucket beside it, for the photo store (src/testing/api.ts).
(globalThis as { testPhotos?: unknown }).testPhotos = proxy.env.PHOTOS;
afterAll(() => proxy.dispose());
