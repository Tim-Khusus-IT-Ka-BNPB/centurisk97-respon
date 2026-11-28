import { sqlState } from "../../src/platform/database.ts";
import { localDatabase } from "./local.ts";

// Applies db/migrations to the database at DATABASE_URL, as the server does when it starts.
// Migrations only go forward: a fix is a new one.
try {
  const { close } = await localDatabase();
  await close();
  console.log("db:migrate: done");
} catch (error: unknown) {
  // Only the SQL state leaves: a driver message may quote a value.
  console.error(`db:migrate failed, ${sqlState(error) ?? "unknown"}`);
  process.exitCode = 1;
}
