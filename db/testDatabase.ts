import { randomBytes } from "node:crypto";
import { afterAll } from "vitest";
import { MEMORY_S3, memoryBucket } from "../src/adapters/s3/memoryBucket.ts";
import { s3PhotoStore } from "../src/adapters/s3/store.ts";
import { postgresDatabase, postgresPool } from "../src/platform/postgres.ts";
import { onServer, TEMPLATE, urlOf } from "./testServer.ts";

// Each server test file gets a database of its own, copied from the migrated and seeded template
// (db/testTemplate.ts), so test files never share rows.
const name = `respon_test_${randomBytes(6).toString("hex")}`;
await onServer((client) => client.query(`create database ${name} template ${TEMPLATE}`));
const pool = postgresPool(urlOf(name), 4);
(globalThis as { testDb?: unknown }).testDb = postgresDatabase(pool);

// The file store beside it: a bucket in memory of its own (src/testing/api.ts).
(globalThis as { testPhotos?: unknown }).testPhotos = s3PhotoStore(MEMORY_S3, memoryBucket().fetcher);

afterAll(async () => {
  if (!pool.ended) await pool.end();
  await onServer((client) => client.query(`drop database if exists ${name} with (force)`));
});
