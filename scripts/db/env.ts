import { APP_ENVS, type AppEnv } from "../../src/platform/settings.ts";

const SEED_ENVIRONMENTS = new Set(["local", "test", "staging"]);

export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Setting ${name} is missing. Copy it from .env.example into .env.`);
  return value;
}

export function appEnv(): AppEnv {
  const env = required("APP_ENV");
  if (!(APP_ENVS as readonly string[]).includes(env))
    throw new Error(`Setting APP_ENV is invalid. Use one of ${APP_ENVS.join(", ")}.`);
  return env as AppEnv;
}

export function seedAllowed(env: string): boolean {
  return SEED_ENVIRONMENTS.has(env);
}

// Where the local D1 database of an environment lives. The dev server keeps its own under
// .wrangler/state; the browser tests get theirs, so a test run never touches dev data.
export function localState(env: AppEnv): string {
  if (env === "local") return ".wrangler/state";
  if (env === "test") return ".wrangler/e2e";
  throw new Error(`Refusing to touch a local database for APP_ENV ${env}: only local and test have one.`);
}
