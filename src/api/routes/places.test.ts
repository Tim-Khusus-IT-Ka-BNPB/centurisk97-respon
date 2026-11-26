import { describe, expect, test } from "vitest";
import { placeResultsSchema } from "../../contract/card";
import { windowStart } from "../../domain/limits";
import { addressBucket } from "../../platform/address";
import { hmacKey } from "../../platform/keys";
import { browser, failingDatabase, manualClock, query, testBindings } from "../../testing/api";
import { api } from "../app";
import type { ApiBindings } from "../context";

const clock = manualClock("2026-11-23T03:00:00.000Z");
const { bindings, lines } = testBindings({}, { clock });

const phoneWith = (with_: ApiBindings) => browser((request: Request) => api.app.fetch(request, with_));
const search = (path: string, with_: ApiBindings = bindings) => phoneWith(with_).call("GET", path);
type Results = { items: { level: string; code: string; name: string }[]; total: number; cut: boolean };
const results = (json: unknown) => placeResultsSchema.parse(json) as Results;

describe("place search across the country", () => {
  test("a name shared by many places lists 10, districts before villages, with the total and the cut flag", async () => {
    const answer = await search("/places/search?q=Sukamaju");
    expect(answer.status).toBe(200);
    const body = results(answer.json);
    expect(body.total).toBe(72);
    expect(body.cut).toBe(true);
    expect(body.items).toHaveLength(10);
    expect(body.items.map((item) => item.level)).toEqual(["district", ...Array(9).fill("village")]);
    expect(answer.json).toMatchObject({ dataDate: "2026-10-25" });
  });

  test("every typed word must match, in any order", async () => {
    const body = results((await search("/places/search?q=utara%20aceh")).json);
    expect(body.items[0]).toMatchObject({ level: "regency", code: "11.08", name: "Aceh Utara" });
    const narrowed = results((await search("/places/search?q=sukamaju%20luwu")).json);
    expect(narrowed.total).toBeLessThan(72);
    expect(narrowed.items.every((item) => item.code.startsWith("73.22"))).toBe(true);
  });

  test("a regency whose name starts with the first word is listed before one that only holds it", async () => {
    const body = results((await search("/places/search?q=kota%20tual")).json);
    expect(body.items[0]).toMatchObject({ level: "regency", name: "Kota Tual" });
  });

  test("a slip of one letter or an old spelling still finds the place, said to be a close match", async () => {
    for (const typed of ["sukamajo", "sukmaju", "sukamaaju", "soekamadjoe"]) {
      const body = placeResultsSchema.parse((await search(`/places/search?q=${typed}`)).json);
      expect(body.similar, typed).toBe(true);
      expect(body.items[0]?.name.toLowerCase(), typed).toContain("sukamaju");
    }
    // Found as typed, it is not called close.
    expect(placeResultsSchema.parse((await search("/places/search?q=sukamaju")).json).similar).toBeUndefined();
    // A word too short to bend is matched as typed.
    expect((await search("/places/search?q=xqz%20sukamajo")).json).toMatchObject({ total: 0, similar: false });
  });

  test("no match answers an empty list, not an error", async () => {
    const answer = await search("/places/search?q=zzqx");
    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({ items: [], total: 0, cut: false });
  });

  test("a query of one letter words names no place", async () => {
    expect((await search("/places/search?q=a%20b%20c")).json).toMatchObject({ items: [], total: 0 });
  });

  test("a query under 3 or over 60 characters is refused naming the field", async () => {
    const short = await search("/places/search?q=su");
    expect(short.status).toBe(422);
    expect(short.error.fields).toEqual([{ fieldId: "q", copyKey: "fieldError.query.tooShort", params: {} }]);
    const long = await search(`/places/search?q=${"a".repeat(61)}`);
    expect(long.error.fields[0]?.copyKey).toBe("fieldError.query.tooLong");
    expect((await search(`/places/search?q=${"a".repeat(60)}`)).status).toBe(200);
    expect((await search("/places/search?q=suk")).status).toBe(200);
  });

  test("a missing query is malformed", async () => {
    expect((await search("/places/search")).status).toBe(400);
  });
});

describe("villages inside a regency or district", () => {
  test("the largest regency lists 40 of its villages with the total, and its last village is found by name", async () => {
    const answer = await search("/places/regencies/11.08/villages");
    const body = results(answer.json);
    expect([body.total, body.items.length, body.cut]).toEqual([844, 40, true]);
    expect(answer.json).toMatchObject({ area: { level: "regency", code: "11.08", name: "Aceh Utara" } });
    const [last] = await query<{ name: string }>`
      select v.name from place_village v join place_snapshot s on s.id = v.snapshot_id and s.active
      where v.regency_code = '11.08' order by v.name desc limit 1`;
    const name = (last as { name: string }).name;
    const filtered = results((await search(`/places/regencies/11.08/villages?q=${encodeURIComponent(name)}`)).json);
    expect(filtered.items.map((item) => item.name)).toContain(name);
    expect(filtered.cut).toBe(false);
  });

  test("a district lists only its own villages", async () => {
    const answer = await search("/places/districts/11.08.01/villages");
    const body = results(answer.json);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((item) => item.code.startsWith("11.08.01."))).toBe(true);
    expect(answer.json).toMatchObject({ area: { level: "district", code: "11.08.01", regencyName: "Aceh Utara" } });
  });

  test("an area the place data does not hold is not found, and a malformed code is refused", async () => {
    expect((await search("/places/regencies/99.99/villages")).status).toBe(404);
    expect((await search("/places/districts/99.99.99/villages")).status).toBe(404);
    expect((await search("/places/regencies/11.0x/villages")).status).toBe(400);
  });

  test("a filter over 60 characters is refused", async () => {
    expect((await search(`/places/regencies/11.08/villages?q=${"a".repeat(61)}`)).status).toBe(422);
  });
});

describe("when place data cannot be read", () => {
  test("the fault flag answers place.unavailable with 503 on every search route", async () => {
    const { bindings: faulty } = testBindings({ FAULT_PLACE: "on" }, { clock });
    for (const path of ["/places/search?q=sukamaju", "/places/regencies/11.08/villages"]) {
      const answer = await search(path, faulty);
      expect(answer.status).toBe(503);
      expect(answer.error.error).toEqual({ code: "place.unavailable", copyKey: "error.place.unavailable", params: {} });
    }
  });

  test("no active snapshot answers place.unavailable", async () => {
    const [active] = await query<{ id: number }>`select id from place_snapshot where active = 1`;
    await query`update place_snapshot set active = 0 where active = 1`;
    try {
      const answer = await search("/places/search?q=sukamaju");
      expect(answer.status).toBe(503);
      expect(answer.error.error.code).toBe("place.unavailable");
    } finally {
      await query`update place_snapshot set active = 1 where id = ${active?.id}`;
    }
  });

  test("a database that fails answers place.unavailable and logs no query text", async () => {
    const broken = failingDatabase("network lost");
    lines.length = 0;
    const answer = await search("/places/search?q=sukamaju", { ...bindings, db: broken });
    expect(answer.status).toBe(503);
    expect(answer.error.error.code).toBe("place.unavailable");
    expect(lines).toContainEqual({ event: "place.failed", errorCode: "place.unavailable" });
    expect(JSON.stringify(lines)).not.toContain("sukamaju");
  });

  test("a driver error is logged by its SQLite code only", async () => {
    const failing = failingDatabase("D1_ERROR: no such table: place_snapshot near sukamaju: SQLITE_ERROR");
    lines.length = 0;
    const answer = await search("/places/search?q=sukamaju", { ...bindings, db: failing });
    expect(answer.status).toBe(503);
    expect(lines).toContainEqual({ event: "place.failed", errorCode: "place.unavailable", sqlState: "SQLITE_ERROR" });
  });
});

describe("the search limit per address", () => {
  test("the 1000th search in an hour passes and the 1001st is refused with its retry time", async () => {
    const phone = phoneWith(bindings);
    const key = await hmacKey(bindings.settings.keyHmacSecret, "address", addressBucket(phone.address) as string);
    await query`insert into rate_counter (limit_id, subject_key, window_start, count)
      values ('address.searches', ${key}, ${new Date(windowStart("clockHour", clock.now()))}, 999)`;
    expect((await phone.call("GET", "/places/search?q=sukamaju")).status).toBe(200);
    const refused = await phone.call("GET", "/places/regencies/11.08/villages");
    expect(refused.status).toBe(429);
    expect(refused.error.error.code).toBe("limit.address.searches");
    expect(refused.error.retryAt).toEqual({ utc: "2026-11-23T04:00:00.000Z", zone: "WIB" });
  });
});
