import { randomBytes } from "node:crypto";
import { afterAll } from "vitest";
import { getPlatformProxy } from "wrangler";
import { postgresDatabase, postgresPool } from "../src/platform/postgres.ts";
import { onServer, TEMPLATE, urlOf } from "./testServer.ts";

// Each server test file gets a database of its own, copied from the migrated and seeded template
// (db/testTemplate.ts), so test files never share rows.
const name = `respon_test_${randomBytes(6).toString("hex")}`;
await onServer((client) => client.query(`create database ${name} template ${TEMPLATE}`));
const pool = postgresPool(urlOf(name), 4);
(globalThis as { testDb?: unknown }).testDb = postgresDatabase(pool);

// The R2 bucket beside it, for the photo store (src/testing/api.ts).
const proxy = await getPlatformProxy<{ PHOTOS: unknown }>({ configPath: "wrangler.jsonc", persist: false });
(globalThis as { testPhotos?: unknown }).testPhotos = proxy.env.PHOTOS;

afterAll(async () => {
  await proxy.dispose();
  if (!pool.ended) await pool.end();
  await onServer((client) => client.query(`drop database if exists ${name} with (force)`));
});
