import pg from "pg";
import { appEnv, required } from "./env.ts";

// Drops and makes again the database at DATABASE_URL, for the browser tests' clean start. Only
// APP_ENV test, and only on this machine.
const env = appEnv();
const url = new URL(required("DATABASE_URL"));
const name = url.pathname.slice(1);
if (env !== "test" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !/^[a-z_][a-z0-9_]*$/.test(name)) {
  console.error("db:reset refused: only APP_ENV test, on a local server, with a plain database name.");
  process.exit(1);
}
url.pathname = "/postgres";
const client = new pg.Client({ connectionString: url.href });
await client.connect();
try {
  await client.query(`drop database if exists ${name} with (force)`);
  await client.query(`create database ${name}`);
  console.log(`db:reset: ${name} is empty`);
} finally {
  await client.end();
}
