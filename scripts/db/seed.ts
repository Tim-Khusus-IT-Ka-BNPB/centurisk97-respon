import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Database } from "../../src/platform/database.ts";
import { appEnv, seedAllowed } from "./env.ts";
import { localDatabase } from "./local.ts";

// Seed files run in name order; each exports a default function that receives the database.
const SEED_DIR = "db/seed";

const env = appEnv();
if (!seedAllowed(env)) {
  console.error(`db:seed refused: APP_ENV is ${env}. Seeding runs only in local, test and staging.`);
  process.exit(1);
}

const files = (await readdir(SEED_DIR)).filter((name) => name.endsWith(".ts")).sort();
const { db, close } = await localDatabase();
try {
  for (const name of files) {
    const module: { default: (db: Database) => Promise<void> } = await import(
      pathToFileURL(resolve(join(SEED_DIR, name))).href
    );
    await module.default(db);
    console.log(`seed ${name}: done`);
  }
} catch (error: unknown) {
  // Only the SQLite code leaves: a driver message may quote a value.
  const code = /SQLITE_[A-Z_]+/.exec(String((error as Error | null)?.message))?.[0] ?? "unknown";
  console.error(`db:seed failed, ${code}`);
  process.exitCode = 1;
} finally {
  await close();
}
