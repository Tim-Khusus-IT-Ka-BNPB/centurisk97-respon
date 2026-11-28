import { describe, expect, test } from "vitest";
import { racing, testDatabase } from "../testing/api";
import { atomically, changedOne, holds, joined, LostRace, previousChangedOne, row, rows, run, sql } from "./database";

describe("values bound to a statement", () => {
  test("each value says its own type; an instant reads back as ISO text, nothing missing as null", async () => {
    const bound = await row(
      testDatabase(),
      sql`select ${new Date("2026-11-23T03:00:00.000Z")} as instant, ${true} as yes, ${false} as no,
        ${{ a: [1] }} as object, ${[1, "two"]} as list, ${undefined} as missing, ${sql`'inlined'`} as fragment,
        ${7} as small, ${1_764_000_000_000} as large, ${0.5} as half, ${"text"} as words,
        pg_typeof(${7}) as small_type, pg_typeof(${1_764_000_000_000}) as large_type`,
    );
    expect(bound).toEqual({
      instant: "2026-11-23T03:00:00.000Z",
      yes: true,
      no: false,
      object: { a: [1] },
      list: [1, "two"],
      missing: null,
      fragment: "inlined",
      small: 7,
      large: 1_764_000_000_000,
      half: 0.5,
      words: "text",
      small_type: "integer",
      large_type: "bigint",
    });
  });

  test("fragments join with a separator, their values in order", async () => {
    const list = joined([sql`${1}`, sql`${2}`, sql`${3}`]);
    expect(await rows(testDatabase(), sql`select unnest(array[${list}]) as n`)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    expect(joined([])).toEqual({ text: "", values: [] });
  });
});

describe("a batch", () => {
  const key = () => `batch-${crypto.randomUUID()}`;
  const counter = (subject: string) =>
    sql`insert into rate_counter (limit_id, subject_key, window_start, count) values ('test', ${subject}, '2026-01-01T00:00:00Z', 1)`;
  const kept = async (subject: string) =>
    (await rows(testDatabase(), sql`select 1 from rate_counter where subject_key = ${subject}`)).length;

  test("runs every statement in order and answers each one's rows", async () => {
    const subject = key();
    const done = await atomically(testDatabase(), [
      counter(subject),
      sql`select count from rate_counter where subject_key = ${subject}`,
    ]);
    expect(done).toEqual([[], [{ count: 1 }]]);
  });

  test("a guard that does not hold undoes the statements before it", async () => {
    const subject = key();
    expect(await atomically(testDatabase(), [counter(subject), holds(sql`1 = 2`)])).toBeNull();
    expect(await kept(subject)).toBe(0);
    expect(await atomically(testDatabase(), [counter(subject), holds(sql`1 = 1`)])).not.toBeNull();
    expect(await kept(subject)).toBe(1);
  });

  test("changedOne holds only when the statement before changed exactly one row", async () => {
    const subject = key();
    const none = sql`update rate_counter set count = 5 where subject_key = 'nobody'`;
    expect(await atomically(testDatabase(), [none, changedOne, counter(subject)])).toBeNull();
    expect(await kept(subject)).toBe(0);
    expect(await atomically(testDatabase(), [counter(subject), changedOne])).not.toBeNull();
  });

  test("a statement may ask whether the one before it changed a row", async () => {
    const subject = key();
    const ifChanged = (changed: string) =>
      sql`insert into rate_counter (limit_id, subject_key, window_start, count)
        select ${changed}, ${subject}, now(), 1 where ${previousChangedOne}`;
    await atomically(testDatabase(), [sql`update rate_counter set count = 1 where false`, ifChanged("never")]);
    await atomically(testDatabase(), [counter(subject), ifChanged("written")]);
    expect(
      await rows(
        testDatabase(),
        sql`select limit_id from rate_counter where subject_key = ${subject} order by limit_id`,
      ),
    ).toEqual([{ limit_id: "test" }, { limit_id: "written" }]);
  });

  test("a unique key another request took first is a lost race; another fault is thrown", async () => {
    const subject = key();
    await run(testDatabase(), counter(subject));
    expect(await atomically(testDatabase(), [counter(subject)])).toBeNull();
    await expect(atomically(testDatabase(), [sql`select * from no_such_table`])).rejects.toMatchObject({
      code: "42P01",
    });
  });

  test("a race lost in a hook is the same lost race", async () => {
    const lost = racing(async () => "lose");
    expect(await atomically(lost, [sql`select 1`])).toBeNull();
    expect(new LostRace().message).toBe("database.lostRace");
  });
});
