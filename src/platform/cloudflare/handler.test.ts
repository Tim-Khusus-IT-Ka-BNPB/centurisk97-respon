import { describe, expect, test } from "vitest";
import { testDatabase } from "../../testing/api";
import { vapidKeys } from "../../testing/push";
import type { Database } from "../database";
import type { LogLine } from "../log";
import { createWorker, statusOf } from "./handler";

const pending: Promise<unknown>[] = [];
const ctx = { waitUntil: (work: Promise<unknown>) => pending.push(work) } as unknown as ExecutionContext;
const ORIGIN = "http://localhost:5173";
const goodEnv = () =>
  ({
    APP_ENV: "test",
    APP_ORIGIN: ORIGIN,
    KEY_HMAC_SECRET: "test-sample-hmac-key-at-least-32-bytes",
    IDENTITY_ADAPTER: "seeded",
    MODEL_MODE: "off",
    DB: testDatabase(),
  }) as unknown as Env;
const request = (url: string, init?: RequestInit) =>
  new Request(url, init) as Request<unknown, IncomingRequestCfProperties>;

function worker() {
  const lines: LogLine[] = [];
  const handler = createWorker(
    async (pageRequest, context) => {
      if (new URL(pageRequest.url).pathname === "/read") return context.api("GET", "/health");
      return new Response(`page ${context.runtime}`, { headers: { "x-page": "1" } });
    },
    "test-runtime",
    (_level, line) => lines.push(line),
  );
  return { handler, lines };
}

describe("worker handler", () => {
  test("api addresses go to the api", async () => {
    const response = await worker().handler.fetch(
      request("http://localhost/api/health", { headers: { "cf-connecting-ip": "::1" } }),
      goodEnv(),
      ctx,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  test("other addresses go to the pages, with the referrer kept inside the site", async () => {
    const response = await worker().handler.fetch(request("http://localhost/"), goodEnv(), ctx);
    expect(await response.text()).toBe("page test-runtime");
    expect(response.headers.get("referrer-policy")).toBe("same-origin");
    expect(response.headers.get("x-page")).toBe("1");
  });

  test("a page read reaches the api through the bridge", async () => {
    const response = await worker().handler.fetch(
      request("http://localhost/read", { headers: { "cf-connecting-ip": "::1" } }),
      goodEnv(),
      ctx,
    );
    expect(await response.text()).toBe("ok");
  });

  test("settings are read once per environment", async () => {
    const { handler } = worker();
    const env = goodEnv();
    await handler.fetch(request("http://localhost/"), env, ctx);
    (env as unknown as Record<string, unknown>).APP_ENV = "nonsense";
    const again = await handler.fetch(request("http://localhost/"), env, ctx);
    expect(again.status).toBe(200);
  });

  test("a bad setting refuses every request and names the setting, never the value", async () => {
    const { handler, lines } = worker();
    const env = {
      ...goodEnv(),
      MODEL_API_KEY: "sk-live-should-not-print",
      APP_ORIGIN: "https://example.test",
    } as Env;
    const first = await handler.fetch(request("http://localhost/"), env, ctx);
    const second = await handler.fetch(request("http://localhost/api/health"), env, ctx);
    expect([first.status, second.status]).toEqual([503, 503]);
    expect(first.headers.get("referrer-policy")).toBe("no-referrer");
    expect(lines).toEqual([{ event: "settings.refused", settings: ["APP_ORIGIN", "MODEL_API_KEY"] }]);
    expect(JSON.stringify(lines)).not.toContain("sk-live");
  });

  test("a missing database binding is named", async () => {
    const { handler, lines } = worker();
    const { DB: _, ...env } = goodEnv() as unknown as Record<string, unknown>;
    await handler.fetch(request("http://localhost/"), env as unknown as Env, ctx);
    expect(lines).toEqual([{ event: "settings.refused", settings: ["DB"] }]);
  });

  test("an unexpected start failure is not swallowed", async () => {
    const { handler } = worker();
    const env = new Proxy(goodEnv() as object, {
      get() {
        throw new TypeError("binding broke");
      },
    }) as Env;
    await expect(handler.fetch(request("http://localhost/"), env, ctx)).rejects.toThrow("binding broke");
  });

  const controller = { cron: "*/15 * * * *", scheduledTime: 0, noRetry: () => {} } as ScheduledController;
  // A clock before every row any test file writes, the sweep test's own past day included, so this
  // run never expires another file's drafts while that file is still using them.
  const sweepEnv = () => ({ ...goodEnv(), CLOCK_FIXED: "2000-01-01T00:00:00.000Z" }) as unknown as Env;

  test("the scheduled event runs the sweep and logs it", async () => {
    const { handler, lines } = worker();
    await expect(handler.scheduled(controller, sweepEnv())).resolves.toBeUndefined();
    expect(lines.map((line) => line.event)).toEqual(["sweep.done", "warnings.done"]);
  });

  test("a failed warnings send is logged as its own step, after the sweep", async () => {
    const { handler, lines } = worker();
    const real = testDatabase();
    // The sweep reads and writes as usual; the warnings' first read breaks.
    const db = new Proxy(real, {
      get(target, name) {
        if (name !== "prepare") return Reflect.get(target, name);
        return (text: string) => {
          if (text.includes("warning_pause")) throw new Error("D1_ERROR: no such table: warning_pause: SQLITE_ERROR");
          return target.prepare(text);
        };
      },
    });
    const push = await vapidKeys();
    const env = {
      ...sweepEnv(),
      DB: db,
      PUSH_PUBLIC_KEY: push.publicKey,
      PUSH_PRIVATE_KEY: push.privateKey,
      PUSH_SUBJECT: push.subject,
    } as unknown as Env;
    await expect(handler.scheduled(controller, env)).rejects.toThrow("Scheduled warnings failed");
    expect(lines.map((line) => line.event)).toEqual(["sweep.done", "warnings.failed"]);
    expect(lines.at(-1)).toEqual({ event: "warnings.failed", errorCode: "warnings.failed", sqlState: "SQLITE_ERROR" });
  });

  test("a bad setting refuses the scheduled run as it refuses requests", async () => {
    const { handler, lines } = worker();
    await handler.scheduled(controller, { ...sweepEnv(), APP_ENV: "nonsense" } as Env);
    expect(lines).toEqual([{ event: "settings.refused", settings: ["APP_ENV"] }]);
  });

  // A database whose every batch fails with the given message.
  const failing = (message: string) =>
    ({
      prepare: () => ({ bind: () => ({}) }),
      batch: async () => {
        throw new Error(message);
      },
    }) as unknown as Database;

  test("a failed sweep is logged without the driver's message and fails the run", async () => {
    const { handler, lines } = worker();
    const env = { ...sweepEnv(), DB: failing("network lost near a sukamaju row") } as unknown as Env;
    await expect(handler.scheduled(controller, env)).rejects.toThrow("Scheduled sweep failed");
    expect(lines).toEqual([{ event: "sweep.failed", errorCode: "sweep.failed" }]);
  });

  test("a driver error in the sweep is logged by its SQLite code", async () => {
    const { handler, lines } = worker();
    const env = {
      ...sweepEnv(),
      DB: failing("D1_ERROR: no such table: report_draft near sukamaju: SQLITE_ERROR"),
    } as unknown as Env;
    await expect(handler.scheduled(controller, env)).rejects.toThrow("Scheduled sweep failed");
    expect(lines).toEqual([{ event: "sweep.failed", errorCode: "sweep.failed", sqlState: "SQLITE_ERROR" }]);
  });
});

test("upstream's status file is read from its bucket where one is bound, and is nothing where none is", async () => {
  const kept = new Map([["dampak_peringatan/status.json", '{"dibuat":"2026-11-26T05:00:00+07:00"}']]);
  const media = {
    get: async (key: string) => {
      const text = kept.get(key);
      return text === undefined ? null : { text: async () => text };
    },
  };
  expect(await statusOf({ UPSTREAM_MEDIA: media } as unknown as Env)()).toEqual({
    dibuat: "2026-11-26T05:00:00+07:00",
  });
  kept.clear();
  expect(await statusOf({ UPSTREAM_MEDIA: media } as unknown as Env)()).toBeNull();
  expect(await statusOf({} as Env)()).toBeNull();
});
