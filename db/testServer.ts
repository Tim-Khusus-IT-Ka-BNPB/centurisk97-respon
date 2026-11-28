import pg from "pg";

// The Postgres the tests use: the local server, or CI's service container. Each run migrates and
// seeds one template database; each test file copies it into a database of its own.
const TEST_SERVER = process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/postgres";
export const TEMPLATE = "respon_test_template";

export function urlOf(name: string): string {
  const url = new URL(TEST_SERVER);
  url.pathname = `/${name}`;
  return url.href;
}

export async function onServer<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: TEST_SERVER });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}
