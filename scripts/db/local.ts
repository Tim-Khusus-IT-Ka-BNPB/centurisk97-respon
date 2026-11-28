import type { Database } from "../../src/platform/database.ts";
import { connect } from "../../src/platform/postgres.ts";
import { required } from "./env.ts";

// The database at DATABASE_URL, migrated: the one the dev server or the browser tests use.
export async function localDatabase(): Promise<{ db: Database; close: () => Promise<void> }> {
  return connect(required("DATABASE_URL"));
}
