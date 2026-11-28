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
