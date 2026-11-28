import { describe, expect, test } from "vitest";
import { MEMORY_S3, memoryBucket } from "../adapters/s3/memoryBucket";
import { s3PhotoStore } from "../adapters/s3/store";
import { failingDatabase, testDatabase } from "../testing/api";
import { vapidKeys } from "../testing/push";
import { createApp, readSettings } from "./app";
import type { Database } from "./database";
import type { LogLine } from "./log";

const ORIGIN = "http://localhost:5173";
const SETTINGS = {
  APP_ENV: "test",
  APP_ORIGIN: ORIGIN,
  KEY_HMAC_SECRET: "test-sample-hmac-key-at-least-32-bytes",
  IDENTITY_ADAPTER: "seeded",
  DATABASE_URL: "postgres://localhost:5432/respon_test",
  MODEL_MODE: "off",
  // A clock before every row any test file writes, the sweep test's own past day included, so a
  // scheduled run never expires another file's drafts while that file is still using them.
  CLOCK_FIXED: "2000-01-01T00:00:00.000Z",
};

function app(source: Record<string, string> = SETTINGS, db: Database = testDatabase()) {
  const lines: LogLine[] = [];
  const started = readSettings(source, (_level, line) => lines.push(line));
  if (started === null) throw new Error("settings refused");
  const running = createApp({
    ...started,
    db,
    photos: s3PhotoStore(MEMORY_S3, memoryBucket().fetcher),
    pages: async (pageRequest, context) => {
      if (new URL(pageRequest.url).pathname === "/read") return context.api("GET", "/health");
      return new Response(`page ${context.runtime}`, { headers: { "x-page": "1" } });
    },
    runtime: "test-runtime",
  });
  return { running, lines };
}

describe("one fetch for every request", () => {
  test("api addresses go to the api", async () => {
    const response = await app().running.fetch(
      new Request("http://localhost/api/health", { headers: { "x-client-address": "::1" } }),
    );
    expect([response.status, await response.text()]).toEqual([200, "ok"]);
  });

  test("other addresses go to the pages, with the referrer kept inside the site", async () => {
    const response = await app().running.fetch(new Request("http://localhost/"));
    expect(await response.text()).toBe("page test-runtime");
    expect(response.headers.get("referrer-policy")).toBe("same-origin");
    expect(response.headers.get("x-page")).toBe("1");
  });

  test("a page read reaches the api through the bridge", async () => {
    const response = await app().running.fetch(
      new Request("http://localhost/read", { headers: { "x-client-address": "::1" } }),
    );
    expect(await response.text()).toBe("ok");
  });
});

describe("settings at start", () => {
  test("a bad setting refuses the start and is named, never its value", () => {
    const lines: LogLine[] = [];
    const started = readSettings(
      { ...SETTINGS, MODEL_API_KEY: "sk-live-should-not-print", APP_ORIGIN: "https://example.test" },
      (_level, line) => lines.push(line),
    );
    expect(started).toBeNull();
    expect(lines).toEqual([{ event: "settings.refused", settings: ["APP_ORIGIN", "MODEL_API_KEY"] }]);
    expect(JSON.stringify(lines)).not.toContain("sk-live");
  });

  test("an unexpected failure while reading them is not swallowed", () => {
    const broken = new Proxy(SETTINGS, {
      get() {
        throw new TypeError("environment broke");
      },
    });
    expect(() => readSettings(broken)).toThrow("environment broke");
  });
});

describe("the run every 15 minutes", () => {
  test("runs the sweep, then the warnings, and logs both", async () => {
    const { running, lines } = app();
    await expect(running.scheduled()).resolves.toBeUndefined();
    expect(lines.map((line) => line.event)).toEqual(["sweep.done", "warnings.done"]);
  });

  test("a failed warnings send is logged as its own step, after the sweep", async () => {
    const real = testDatabase();
    // The sweep reads and writes as usual; the warnings' first read breaks.
    const db: Database = {
      query: async (text, values) => {
        if (text.includes("warning_pause"))
          throw Object.assign(new Error('relation "warning_pause" does not exist'), { code: "42P01" });
        return real.query(text, values);
      },
      batch: (queries) => real.batch(queries),
    };
    const push = await vapidKeys();
    const { running, lines } = app(
      { ...SETTINGS, PUSH_PUBLIC_KEY: push.publicKey, PUSH_PRIVATE_KEY: push.privateKey, PUSH_SUBJECT: push.subject },
      db,
    );
    await expect(running.scheduled()).rejects.toThrow("Scheduled warnings failed");
    expect(lines.map((line) => line.event)).toEqual(["sweep.done", "warnings.failed"]);
    expect(lines.at(-1)).toEqual({ event: "warnings.failed", errorCode: "warnings.failed", sqlState: "42P01" });
  });

  test("a failed sweep is logged without the driver's message, by its SQL state when it has one", async () => {
    const plain = app(SETTINGS, failingDatabase("network lost near a sukamaju row"));
    await expect(plain.running.scheduled()).rejects.toThrow("Scheduled sweep failed");
    expect(plain.lines).toEqual([{ event: "sweep.failed", errorCode: "sweep.failed" }]);
    const coded = app(SETTINGS, failingDatabase('relation "report_draft" does not exist near sukamaju', "42P01"));
    await expect(coded.running.scheduled()).rejects.toThrow("Scheduled sweep failed");
    expect(coded.lines).toEqual([{ event: "sweep.failed", errorCode: "sweep.failed", sqlState: "42P01" }]);
    expect(JSON.stringify(coded.lines)).not.toContain("sukamaju");
  });
});
