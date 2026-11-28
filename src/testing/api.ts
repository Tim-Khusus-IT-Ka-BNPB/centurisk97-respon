import { type EdgeStore, edgeCache } from "../adapters/cache/edgeCache";
import { seededIdentity } from "../adapters/identity/seeded";
import { modelOff } from "../adapters/model/off";
import { type Bucket, r2PhotoStore } from "../adapters/r2/photoStore";
import type { ApiBindings } from "../api/context";
import type { DraftBody } from "../contract/draft";
import type { ErrorEnvelope } from "../contract/errors";
import { type Database, LostRace, row, rows, run, sql } from "../platform/database";
import { createLogger, type LogLine } from "../platform/log";
import { parseSettings } from "../platform/settings";
import type { ModelPort } from "../ports/model";

export const TEST_ORIGIN = "http://localhost:5173";

// This test file's own Postgres database, copied from the seeded template by db/testDatabase.ts.
export function testDatabase(): Database {
  const db = (globalThis as { testDb?: Database }).testDb;
  if (db === undefined) throw new Error("No test database: db/testDatabase.ts did not run for this file");
  return db;
}

// The in-memory R2 bucket of this test file, made beside its database.
export function testBucket(): Bucket {
  return (globalThis as { testPhotos?: Bucket }).testPhotos as Bucket;
}

// Columns stored as JSON text, read back as values so a test compares what was stored.
const JSON_COLUMNS = new Set(["fields", "back_stack", "asked", "params", "body", "pending_notices"]);

// A test's own read or write on its database, answered as rows.
export async function query<T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]) {
  const found = await rows<Record<string, unknown>>(testDatabase(), sql(strings, ...values));
  return found.map((one) =>
    Object.fromEntries(
      Object.entries(one).map(([column, value]) => [
        column,
        JSON_COLUMNS.has(column) && typeof value === "string" ? JSON.parse(value) : value,
      ]),
    ),
  ) as T[];
}

// A database whose every statement fails with this error, as a driver error would.
export function failingDatabase(message: string, code?: string): Database {
  const fail = async (): Promise<never> => {
    throw Object.assign(new Error(message), code === undefined ? {} : { code });
  };
  return { query: fail, batch: fail };
}

// The test database, with a hook that sees each batch's statements before it runs and may make
// it lose a race, as when another request wrote first. `write` runs the batch for real.
// `beforeRead` runs before each single statement, as another request writing between two reads.
export function racing(
  hook: (texts: readonly string[], write: () => Promise<unknown>) => Promise<"lose" | "pass">,
  beforeRead: (text: string) => Promise<void> = async () => {},
  db: Database = testDatabase(),
): Database {
  return {
    query: async (text, values) => {
      await beforeRead(text);
      return db.query(text, values);
    },
    batch: async (queries) => {
      const write = () => db.batch(queries);
      if (
        (await hook(
          queries.map((query) => query.text),
          write,
        )) === "lose"
      )
        throw new LostRace();
      return write();
    },
  };
}

// Until undone, an insert into this table that meets the condition fails as a race lost to another
// request that took the row first. The condition is trusted SQL of the test's own.
export async function loseInserts(name: string, table: string, condition: string): Promise<() => Promise<void>> {
  const db = testDatabase();
  const raw = (text: string) => run(db, { text, values: [] });
  await raw(`create function ${name}() returns trigger language plpgsql as $$ begin
      if ${condition} then raise exception 'lost' using errcode = 'unique_violation'; end if; return new; end $$`);
  await raw(`create trigger ${name} before insert on ${table} for each row execute function ${name}()`);
  return async () => {
    await raw(`drop trigger ${name} on ${table}`);
    await raw(`drop function ${name}()`);
  };
}

// Loses the first batch whose statements include this text, then lets every batch through.
export function losesOnce(text: string, before: (write: () => Promise<unknown>) => Promise<void> = async () => {}) {
  let lost = false;
  return racing(async (texts, write) => {
    if (lost || !texts.some((one) => one.includes(text))) return "pass";
    lost = true;
    await before(write);
    return "lose";
  });
}

// A clock a test moves by hand.
export function manualClock(start: string | number) {
  let nowMs = typeof start === "number" ? start : Date.parse(start);
  return {
    now: () => nowMs,
    set: (instant: number) => {
      nowMs = instant;
    },
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

type TestOptions = { readonly clock?: { now(): number }; readonly model?: ModelPort; readonly edge?: EdgeStore };

// Cloudflare's cache as a map that honours max-age by the test's clock.
export function testEdgeStore(clock: { now(): number }): EdgeStore {
  const kept = new Map<string, { text: string; until: number }>();
  return {
    async match(key) {
      const found = kept.get(key);
      return found !== undefined && found.until > clock.now() ? new Response(found.text) : undefined;
    },
    async put(key, response) {
      const seconds = Number(/max-age=(\d+)/.exec(response.headers.get("cache-control") ?? "")?.[1] ?? 0);
      kept.set(key, { text: await response.text(), until: clock.now() + seconds * 1000 });
    },
  };
}

// Settings, ports and a capturing logger for API tests, as the Worker would hand them in.
export function testBindings(
  overrides: Record<string, string> = {},
  options: TestOptions = {},
): { bindings: ApiBindings; lines: LogLine[] } {
  const lines: LogLine[] = [];
  const settings = parseSettings(
    {
      APP_ENV: "test",
      APP_ORIGIN: TEST_ORIGIN,
      // The seed keyed the seeded numbers with this secret, so the tests use it too.
      KEY_HMAC_SECRET: import.meta.env.KEY_HMAC_SECRET as string,
      IDENTITY_ADAPTER: "seeded",
      MODEL_MODE: "off",
      ...overrides,
    },
    true,
  );
  const db = testDatabase();
  const clock = options.clock ?? { now: Date.now };
  return {
    bindings: {
      settings,
      log: createLogger("debug", (_level, line) => lines.push(line)),
      db,
      clock,
      identity: seededIdentity(db, clock),
      signIn: null,
      model: options.model ?? modelOff,
      photos: r2PhotoStore(testBucket()),
      // No cache unless a test hands one in, so a change shows on the next read.
      edge: edgeCache(TEST_ORIGIN, options.edge ?? null),
    },
    lines,
  };
}

export const fromBrowser = { "cf-connecting-ip": "198.51.100.2" } as const;
export const jsonWrite = {
  ...fromBrowser,
  origin: TEST_ORIGIN,
  "x-respon-client": "1",
  "content-type": "application/json",
};

const randomDigits = (length: number) => Array.from({ length }, () => Math.floor(Math.random() * 10)).join("");

// A synthetic number no other test uses: 0800 is a toll-free prefix, never a person's phone.
export function freshNumber(): { typed: string; stored: string } {
  const rest = randomDigits(8);
  return { typed: `0800${rest}`, stored: `+62800${rest}` };
}

// An address of the documentation range in its own /64, so its limit buckets are its own.
export function freshAddress(): string {
  const group = () => Math.floor(Math.random() * 0x10000).toString(16);
  return `2001:db8:${group()}:${group()}::1`;
}

type Fetch = (request: Request) => Response | Promise<Response>;

// One browser against the API: its own cookies and address, as a phone would be.
export function browser(fetchApi: Fetch, address = freshAddress()) {
  const cookies = new Map<string, string>();
  const call = async (method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = {
      "cf-connecting-ip": address,
      origin: TEST_ORIGIN,
      "x-respon-client": "1",
    };
    if (cookies.size > 0) headers.cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    if (body !== undefined) headers["content-type"] = "application/json";
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    const response = await fetchApi(new Request(`http://localhost/api${path}`, init));
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const [name, value] = (pair as string).split("=");
      cookies.set(name as string, value as string);
    }
    const text = await response.text();
    const json: unknown = text === "" ? null : JSON.parse(text);
    return { status: response.status, json, draft: json as DraftBody, error: json as ErrorEnvelope };
  };
  // A multipart post, as the page's photo form sends it.
  const upload = async (path: string, form: FormData) => {
    const headers: Record<string, string> = {
      "cf-connecting-ip": address,
      origin: TEST_ORIGIN,
      "x-respon-client": "1",
    };
    if (cookies.size > 0) headers.cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    const response = await fetchApi(
      new Request(`http://localhost/api${path}`, { method: "POST", headers, body: form }),
    );
    const json: unknown = await response.json();
    return { status: response.status, json, draft: json as DraftBody, error: json as ErrorEnvelope };
  };
  // A file read, answered as its status, type and bytes; with a body it is asked for by a post.
  const file = async (path: string, body?: unknown) => {
    const headers: Record<string, string> = {
      "cf-connecting-ip": address,
      origin: TEST_ORIGIN,
      "x-respon-client": "1",
    };
    if (cookies.size > 0) headers.cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    const init: RequestInit =
      body === undefined
        ? { headers }
        : {
            method: "POST",
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify(body),
          };
    const response = await fetchApi(new Request(`http://localhost/api${path}`, init));
    return { status: response.status, headers: response.headers, bytes: new Uint8Array(await response.arrayBuffer()) };
  };
  return { call, upload, file, cookies, address };
}

// A WIB day far from any real one whose ticket counter no other test uses: with lastN 0 it has no
// counter row, otherwise a row at lastN is made for it. A real calendar day is never touched.
export async function unusedDay(lastN: number, db: Database = testDatabase()): Promise<string> {
  for (;;) {
    const day = new Date(
      Date.UTC(2040 + Math.floor(Math.random() * 50), 0, 1) + Math.floor(Math.random() * 365) * 86_400_000,
    );
    const iso = day.toISOString().slice(0, 10);
    const found =
      lastN === 0
        ? await row(db, sql`select 1 as one from ticket_day_counter where wib_date = ${iso}`)
        : await row(
            db,
            sql`insert into ticket_day_counter (wib_date, last_n) values (${iso}, ${lastN}) on conflict do nothing returning 1 as one`,
          );
    if ((lastN === 0 && found === null) || (lastN > 0 && found !== null)) return iso;
  }
}
