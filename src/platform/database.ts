// Respon's Postgres, as far as this app uses it: a statement with its values, and a batch that
// runs every statement or none. node-postgres's pool fits the first; postgresDatabase (postgres.ts)
// builds the second on it. Nothing else here names a driver type.
export type Result = { readonly rows: Record<string, unknown>[]; readonly rowCount: number };

export type Database = {
  query(text: string, values: readonly unknown[]): Promise<Result>;
  // In one serializable transaction, in order. A guard that fails throws LostRace and rolls it back.
  batch(queries: readonly Query[]): Promise<Result[]>;
};

// A statement and its values, built with the sql tag. A value that is itself a Query is inlined,
// so fragments compose; every other value is bound, never pasted into the text. Each bound value
// is marked with a character Postgres text never holds, numbered $1, $2, ... when it runs.
export type Query = {
  readonly text: string;
  readonly values: readonly unknown[];
  // A step of a batch that checks instead of writing: its condition holds, or the statement
  // before it changed exactly one row.
  readonly guard?: "holds" | "changedOne";
};

const BOUND = "\u0000";
// Where a statement of a batch asks whether the one before it changed exactly one row.
const PREVIOUS = "\u0001";

// Postgres types a bare parameter from where it stands, and in a select list (insert ... select)
// it can only guess text. Every value but text and null says its own type.
const INT4_MAX = 2_147_483_647;

function castOf(value: unknown): string {
  if (value instanceof Date) return "::timestamptz";
  if (typeof value === "boolean") return "::boolean";
  if (typeof value === "number") {
    if (!Number.isInteger(value)) return "::double precision";
    return Math.abs(value) <= INT4_MAX ? "::integer" : "::bigint";
  }
  if (typeof value === "object" && value !== null) return "::jsonb";
  return "";
}

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
      text += BOUND + castOf(value);
      bound.push(value);
    }
    text += strings[index + 1] as string;
  });
  return { text, values: bound };
}

export const empty: Query = { text: "", values: [] };

// Fragments one after another, a separator between each.
export function joined(parts: readonly Query[], separator = ", "): Query {
  return parts.reduce<Query>(
    (all, part, index) => ({
      text: all.text + (index === 0 ? "" : separator) + part.text,
      values: [...all.values, ...part.values],
    }),
    empty,
  );
}

// Inside a batch: true when the statement before this one changed exactly one row.
export const previousChangedOne: Query = { text: PREVIOUS, values: [] };

// Instants go in as ISO 8601 text, objects and arrays as JSON for jsonb columns.
function encode(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return value;
}

function numbered(text: string): string {
  let n = 0;
  return text.replaceAll(BOUND, () => {
    n += 1;
    return `$${n}`;
  });
}

const execute = (db: Database, query: Query) => db.query(numbered(query.text), query.values.map(encode));

export async function rows<T>(db: Database, query: Query): Promise<T[]> {
  return (await execute(db, query)).rows as T[];
}

export async function row<T>(db: Database, query: Query): Promise<T | null> {
  return ((await execute(db, query)).rows[0] as T | undefined) ?? null;
}

// Runs one statement and answers how many rows it changed.
export async function run(db: Database, query: Query): Promise<number> {
  return (await execute(db, query)).rowCount;
}

// A condition inside a batch. When it is false the batch rolls back: what a row lock decided in a
// transaction, decided at write time.
export const holds = (condition: Query): Query => ({ ...sql`select (${condition}) as ok`, guard: "holds" });

// The statement before this one changed exactly one row.
export const changedOne: Query = { text: "", values: [], guard: "changedOne" };

export class LostRace extends Error {
  constructor() {
    super("database.lostRace");
  }
}

// What a batch does with its statements, on one transaction's connection.
export async function runBatch(
  query: (text: string, values: readonly unknown[]) => Promise<Result>,
  queries: readonly Query[],
): Promise<Result[]> {
  const results: Result[] = [];
  for (const one of queries) {
    const previous = results.at(-1)?.rowCount === 1;
    if (one.guard === "changedOne") {
      if (!previous) throw new LostRace();
      results.push({ rows: [], rowCount: 0 });
      continue;
    }
    const text = numbered(one.text).replaceAll(PREVIOUS, previous ? "true" : "false");
    const result = await query(text, one.values.map(encode));
    if (one.guard === "holds" && result.rows[0]?.ok !== true) throw new LostRace();
    results.push(result);
  }
  return results;
}

// A broken condition, a unique key another request took first, or a transaction another one
// overtook: the batch lost a race.
const LOST_RACE_CODES = new Set(["23505", "40001", "40P01"]);

// Every statement or none. Answers each statement's rows, or null when a condition did not hold
// or another request wrote first.
export async function atomically(db: Database, queries: readonly Query[]): Promise<unknown[][] | null> {
  try {
    return (await db.batch(queries)).map((result) => result.rows);
  } catch (error) {
    if (error instanceof LostRace || LOST_RACE_CODES.has(sqlState(error) ?? "")) return null;
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

// A driver error is reduced to its SQLSTATE; its message may hold values and is never kept.
export function sqlState(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  // Node's own codes (EPIPE) have no digit; every SQLSTATE has one.
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) && /\d/.test(code) ? code : null;
}
