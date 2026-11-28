import { randomBytes } from "node:crypto";
import { describe, expect, test } from "vitest";
import { onServer, urlOf } from "../../db/testServer.ts";
import { testDatabase } from "../testing/api";
import { atomically, rows, run, sql } from "./database";
import { connect, postgresDatabase, postgresPool } from "./postgres";

// Any database will do for a connection of its own; the server always has this one.
const TEMPLATE_PEER = "postgres";

describe("the Postgres database", () => {
  test("a new database gets every migration when connected, and a second connect changes nothing", async () => {
    const name = `respon_empty_${randomBytes(6).toString("hex")}`;
    await onServer((client) => client.query(`create database ${name}`));
    try {
      for (let times = 0; times < 2; times += 1) {
        const { db, close } = await connect(urlOf(name));
        expect(await rows(db, sql`select count(*) as tables from pg_tables where schemaname = 'public'`)).toEqual([
          { tables: 68 },
        ]);
        await close();
      }
    } finally {
      await onServer((client) => client.query(`drop database if exists ${name} with (force)`));
    }
  });

  test("an idle connection the server closes is let go, and the next query opens another", async () => {
    const pool = postgresPool(urlOf(TEMPLATE_PEER), 1);
    const db = postgresDatabase(pool);
    try {
      const [{ pid }] = (await db.query("select pg_backend_pid() as pid", [])).rows as [{ pid: number }];
      await onServer((client) => client.query("select pg_terminate_backend($1)", [pid]));
      // The pool hears of the closed connection a moment later; the process must outlive it.
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect((await db.query("select 1 as one", [])).rows).toEqual([{ one: 1 }]);
    } finally {
      await pool.end();
    }
  });

  test("a batch another transaction overtook runs again; one overtaken every time is a lost race", async () => {
    const db = testDatabase();
    const raw = (text: string) => run(db, { text, values: [] });
    // A sequence counts outside any transaction, so it survives each rolled back attempt.
    await raw("create sequence overtaken_attempts");
    await raw(`create function overtaken(times bigint) returns boolean language plpgsql as $$ begin
        if nextval('overtaken_attempts') <= times then
          raise exception 'overtaken' using errcode = 'serialization_failure';
        end if;
        return true; end $$`);
    try {
      expect(await atomically(db, [sql`select overtaken(${2}) as ok`])).toEqual([[{ ok: true }]]);
      await raw("select setval('overtaken_attempts', 1, false)");
      expect(await atomically(db, [sql`select overtaken(${100}) as ok`])).toBeNull();
      expect(await rows(db, sql`select last_value from overtaken_attempts`)).toEqual([{ last_value: 5 }]);
    } finally {
      await raw("drop function overtaken(bigint)");
      await raw("drop sequence overtaken_attempts");
    }
  });
});
