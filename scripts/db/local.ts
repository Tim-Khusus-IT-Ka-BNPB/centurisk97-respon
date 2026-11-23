import { getPlatformProxy } from "wrangler";
import type { Database } from "../../src/platform/database.ts";
import { appEnv, localState } from "./env.ts";

// The local D1 database of APP_ENV, the same one the dev server or the browser tests use.
export async function localDatabase(): Promise<{ db: Database; close: () => Promise<void> }> {
  const proxy = await getPlatformProxy<{ DB: Database }>({
    configPath: "wrangler.jsonc",
    persist: { path: `${localState(appEnv())}/v3` },
  });
  return { db: proxy.env.DB, close: proxy.dispose };
}
