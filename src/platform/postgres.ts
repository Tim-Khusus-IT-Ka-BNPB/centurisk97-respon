import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { type Database, type Query, type Result, runBatch, sqlState } from "./database.ts";

// Overtaken by another transaction, or caught in a deadlock with one.
const RETRIED = new Set(["40001", "40P01"]);
const SERIALIZE_ATTEMPTS = 5;

const MIGRATIONS = fileURLToPath(new URL("../../db/migrations", import.meta.url));

// Instants come back as ISO 8601 text in UTC and days as YYYY-MM-DD, as the code reads them;
// counts and sums as numbers.
const TIMESTAMPTZ = 1184;
const DATE = 1082;
const INT8 = 20;
const NUMERIC = 1700;
const parseInstant = pg.types.getTypeParser(TIMESTAMPTZ);
const types = {
  getTypeParser(oid: number, format?: "text" | "binary") {
    if (oid === TIMESTAMPTZ) return (text: string) => (parseInstant(text) as Date).toISOString();
    if (oid === DATE) return (text: string) => text;
    if (oid === INT8 || oid === NUMERIC) return (text: string) => Number(text);
    return pg.types.getTypeParser(oid, format);
  },
} as pg.CustomTypesConfig;

const resultOf = (result: pg.QueryResult): Result => ({ rows: result.rows, rowCount: result.rowCount ?? 0 });

export function postgresDatabase(pool: pg.Pool): Database {
  return {
    query: async (text, values) => resultOf(await pool.query(text, values as unknown[])),
    // Serializable, so a batch decides as if alone. Postgres refuses one that another overtook;
    // the whole batch runs again, a few times, before that counts as a lost race.
    async batch(queries) {
      for (let attempt = 1; ; attempt += 1) {
        try {
          return await once(queries);
        } catch (error) {
          if (attempt >= SERIALIZE_ATTEMPTS || !RETRIED.has(sqlState(error) ?? "")) throw error;
        }
      }
    },
  };

  async function once(queries: readonly Query[]): Promise<Result[]> {
    const client = await pool.connect();
    try {
      await client.query("begin isolation level serializable");
      const results = await runBatch(
        async (text, values) => resultOf(await client.query(text, values as unknown[])),
        queries,
      );
      await client.query("commit");
      return results;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}

export function postgresPool(url: string, max = 10): pg.Pool {
  return new pg.Pool({ connectionString: url, max, types, options: "-c TimeZone=UTC" });
}

// The database at this address with every migration applied.
export async function connect(url: string): Promise<{ db: Database; close(): Promise<void> }> {
  const pool = postgresPool(url);
  await migrate(drizzle({ client: pool }), { migrationsFolder: MIGRATIONS });
  return { db: postgresDatabase(pool), close: () => pool.end() };
}
