import { beforeAll, describe, expect, test } from "vitest";
import { windowStart } from "../../domain/limits";
import { MAX_SUBSCRIBERS } from "../../domain/warnings";
import { addressBucket } from "../../platform/address";
import { run, sql } from "../../platform/database";
import { hmacKey } from "../../platform/keys";
import { browser, freshAddress, query, testBindings, testDatabase } from "../../testing/api";
import { api } from "../app";
import type { ApiBindings } from "../context";

// Made-up keys of the right shape: no push is sent here.
const TEST_PUSH = {
  PUSH_PUBLIC_KEY: `B${"A".repeat(86)}`,
  PUSH_PRIVATE_KEY: "a".repeat(43),
  PUSH_SUBJECT: "mailto:peringatan@example.test",
};
const open = testBindings(TEST_PUSH).bindings;
const shut = testBindings().bindings;
const fetchWith = (bindings: ApiBindings) => (request: Request) =>
  api.app.fetch(request, { ...bindings, db: testDatabase() } satisfies ApiBindings);

let n = 0;
const endpoint = () => {
  n += 1;
  return `https://fcm.googleapis.com/fcm/send/uji-${Date.now()}-${n}`;
};
const keys = { p256dh: "B".repeat(87), auth: "a".repeat(22) };

let districts: { code: string; name: string }[] = [];
beforeAll(async () => {
  districts = await query<{ code: string; name: string }>`
    select d.code, d.name from place_district d join place_snapshot s on s.id = d.snapshot_id and s.active = 1
    where d.regency_code = '11.08' order by d.code limit 4`;
});

const choice = (where: string, extra: object = {}) => ({
  endpoint: where,
  keys,
  districts: districts.slice(0, 2).map((one) => one.code),
  hazards: 3,
  threshold: 2,
  ...extra,
});

describe("warnings of a phone", () => {
  test("the key to subscribe with, or null while warnings are shut", async () => {
    expect((await browser(fetchWith(open)).call("GET", "/warnings/key")).json).toEqual({
      publicKey: TEST_PUSH.PUSH_PUBLIC_KEY,
    });
    expect((await browser(fetchWith(shut)).call("GET", "/warnings/key")).json).toEqual({ publicKey: null });
  });

  test("a phone picks districts, changes them, sees them and stops", async () => {
    const phone = browser(fetchWith(open));
    const where = endpoint();
    expect((await phone.call("POST", "/warnings/status", { endpoint: where })).json).toEqual({
      districts: [],
      hazards: null,
      threshold: null,
    });
    const kept = await phone.call("PUT", "/warnings", choice(where));
    expect(kept.status).toBe(200);
    expect(kept.json).toEqual({ districts: districts.slice(0, 2), hazards: 3, threshold: 2 });
    const changed = await phone.call(
      "PUT",
      "/warnings",
      choice(where, { districts: [districts[1]?.code, districts[2]?.code], hazards: 15, threshold: 1 }),
    );
    expect(changed.json).toEqual({ districts: districts.slice(1, 3), hazards: 15, threshold: 1 });
    expect((await phone.call("POST", "/warnings/status", { endpoint: where })).json).toEqual(changed.json);
    const [stored] = await query<Record<string, unknown>>`
      select regency_code, p256dh from warning_subscription where endpoint = ${where} limit 1`;
    expect(stored).toEqual({ regency_code: "11.08", p256dh: keys.p256dh });
    expect((await phone.call("POST", "/warnings/stop", { endpoint: where })).status).toBe(204);
    expect(await query`select 1 from warning_subscription where endpoint = ${where}`).toEqual([]);
  });

  test.each([
    ["an address not of a push service", { endpoint: "https://example.test/push/abcdefghijklmnop" }],
    ["plain http", { endpoint: "http://fcm.googleapis.com/fcm/send/abcdefghij" }],
    ["keys of the wrong shape", { keys: { p256dh: "short", auth: keys.auth } }],
    ["no district", { districts: [] }],
    ["four districts", { districts: ["11.08.01", "11.08.02", "11.08.03", "11.08.04"] }],
    ["a district twice", { districts: ["11.08.01", "11.08.01"] }],
    ["a district not known", { districts: ["99.99.99"] }],
    ["no hazard", { hazards: 0 }],
    ["a level past Awas", { threshold: 4 }],
  ])("refused: %s", async (_why, extra) => {
    const answer = await browser(fetchWith(open)).call("PUT", "/warnings", choice(endpoint(), extra));
    expect(answer.status).toBe(400);
  });

  test("shut with no push keys; full past the number of phones, though a phone in may still change", async () => {
    expect((await browser(fetchWith(shut)).call("PUT", "/warnings", choice(endpoint()))).error.error.code).toBe(
      "warnings.closed",
    );
    const inside = endpoint();
    expect((await browser(fetchWith(open)).call("PUT", "/warnings", choice(inside))).status).toBe(200);
    const [{ count } = { count: 0 }] = await query<{ count: number }>`
      select count(distinct endpoint) as count from warning_subscription`;
    const filler = MAX_SUBSCRIBERS - count;
    const db = testDatabase();
    await run(
      db,
      sql`with recursive k(i) as (select 1 union all select i + 1 from k where i < ${filler})
        insert into warning_subscription (endpoint, p256dh, auth, district_code, regency_code, district_name, hazards,
          threshold, created_at)
        select 'https://fcm.googleapis.com/fcm/send/isi-' || i, ${keys.p256dh}, ${keys.auth}, '99.98.01', '99.98',
          'Isi', 15, 1, '2026-11-26T00:00:00.000Z' from k`,
    );
    try {
      const full = await browser(fetchWith(open)).call("PUT", "/warnings", choice(endpoint()));
      expect(full.status).toBe(503);
      expect(full.error.error.code).toBe("warnings.full");
      expect((await browser(fetchWith(open)).call("PUT", "/warnings", choice(inside, { hazards: 1 }))).status).toBe(
        200,
      );
    } finally {
      await run(
        db,
        sql`delete from warning_subscription where endpoint like 'https://fcm.googleapis.com/fcm/send/isi-%'`,
      );
    }
  });

  test("30 changes an hour from one address, then 429; a stop counts too", async () => {
    const phone = browser(fetchWith(open), freshAddress());
    const key = await hmacKey(open.settings.keyHmacSecret, "address", addressBucket(phone.address) as string);
    await query`insert into rate_counter (limit_id, subject_key, window_start, count)
      values ('address.warnings', ${key}, ${new Date(windowStart("clockHour", Date.now()))}, 30)`;
    const refused = await phone.call("PUT", "/warnings", choice(endpoint()));
    expect(refused.status).toBe(429);
    expect(refused.error.error.code).toBe("limit.address.warnings");
    expect((await phone.call("POST", "/warnings/stop", { endpoint: endpoint() })).status).toBe(429);
  });
});
