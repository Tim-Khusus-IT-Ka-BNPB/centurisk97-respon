import { spawnSync } from "node:child_process";
import { appEnv, localState } from "./env.ts";

// Applies db/migrations to the local D1 database of APP_ENV with wrangler's own migration
// command, the one staging uses with --remote. D1 migrations only go forward: a fix is a new one.
const result = spawnSync(
  "wrangler",
  ["d1", "migrations", "apply", "lapor-bencana", "--local", "--persist-to", localState(appEnv())],
  { stdio: "inherit", env: { ...process.env, CI: "1" } },
);
process.exit(result.status ?? 1);
