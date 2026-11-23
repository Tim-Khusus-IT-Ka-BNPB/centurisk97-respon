// The D1 database, as far as this app uses it. D1's own binding fits this shape, and so does the
// local one the tests and scripts get from wrangler, so nothing here names a Cloudflare type.
type Statement = {
  bind(...values: unknown[]): Statement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
};

export type Database = {
  prepare(query: string): Statement;
  batch(statements: Statement[]): Promise<{ results: unknown[] }[]>;
  exec(query: string): Promise<unknown>;
};

// A statement and its values, built with the sql tag. A value that is itself a Query is inlined,
// so fragments compose; every other value is bound, never pasted into the text.
export type Query = { readonly text: string; readonly values: readonly unknown[] };

const isQuery = (value: unknown): value is Query =>
  typeof value === "object" && value !== null && "text" in value && "values" in value && Array.isArray(value.values);

export function sql(strings: TemplateStringsArray, ...values: unknown[]): Query {
  let text = strings[0] as string;
  const bound: unknown[] = [];
  values.forEach((value, index) => {
    if (isQuery(value)) {
      text += value.text;
      bound.push(...value.values);
    } else {
      text += "?";
      bound.push(value);
    }
    text += strings[index + 1] as string;
  });
  return { text, values: bound };
}

export const empty: Query = { text: "", values: [] };

// Instants are stored as ISO 8601 text in UTC, which sorts and compares as time does. Objects
// and arrays are stored as JSON text, booleans as 1 and 0.
function encode(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return value;
}

const statement = (db: Database, query: Query): Statement => db.prepare(query.text).bind(...query.values.map(encode));

export async function rows<T>(db: Database, query: Query): Promise<T[]> {
  return (await statement(db, query).all<T>()).results;
}

export async function row<T>(db: Database, query: Query): Promise<T | null> {
  return statement(db, query).first<T>();
}

// Runs one statement and answers how many rows it changed.
export async function run(db: Database, query: Query): Promise<number> {
  return (await statement(db, query).run()).meta.changes;
}

// A condition inside a batch. When it is false the insert breaks the guard table's check, and
// D1 rolls back the whole batch: what a row lock decided in a transaction, decided at write time.
export const holds = (condition: Query): Query =>
  sql`insert into batch_guard (ok) select case when ${condition} then 1 else 0 end`;

// The statement before this one changed exactly one row.
export const changedOne: Query = holds(sql`changes() = 1`);

// A broken condition, or a unique key another request took first: the batch lost a race.
const LOST_RACE = ["batch_guard_held", "UNIQUE constraint failed"];

// Every statement or none. Answers each statement's rows, or null when a condition did not hold
// or another request wrote first.
export async function atomically(db: Database, queries: readonly Query[]): Promise<unknown[][] | null> {
  const guarded = queries.some((query) => query.text.startsWith("insert into batch_guard"));
  const all = guarded ? [...queries, sql`delete from batch_guard`] : queries;
  try {
    const results = await db.batch(all.map((query) => statement(db, query)));
    return results.slice(0, queries.length).map((result) => result.results);
  } catch (error) {
    const message = String((error as Error | null)?.message);
    if (LOST_RACE.some((sign) => message.includes(sign))) return null;
    throw error;
  }
}

// Reads, decides and writes again while another request keeps winning the race; a decision is
// null when its batch lost. Three losses in a row is a fault, not a race.
export async function decide<T>(attempt: () => Promise<T | null>): Promise<T> {
  for (let tries = 0; tries < 3; tries += 1) {
    const decided = await attempt();
    if (decided !== null) return decided;
  }
  throw new Error("database.contended");
}

// A JSON column read back; null stays null.
export function parsed<T>(text: string | null): T | null {
  return text === null ? null : (JSON.parse(text) as T);
}

// A driver error is reduced to its SQLite result code; its message may hold values and is never kept.
export function sqlState(error: unknown): string | null {
  const code = /SQLITE_[A-Z_]+/.exec(String((error as Error | null)?.message))?.[0];
  return code ?? null;
}
