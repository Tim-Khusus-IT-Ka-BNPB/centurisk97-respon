import { z } from "zod";

export const APP_ENVS = ["local", "test", "staging", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

type ModelSettings =
  | { readonly mode: "off" }
  | { readonly mode: "recorded"; readonly baseUrl: string; readonly name: string }
  | { readonly mode: "live"; readonly baseUrl: string; readonly apiKey: string; readonly name: string };

export type Settings = {
  readonly appEnv: AppEnv;
  readonly appOrigin: string;
  readonly keyHmacSecret: string;
  readonly identityAdapter: "seeded" | "upstream";
  readonly model: ModelSettings;
  readonly clockFixedMs: number | null;
  readonly faultSend: boolean;
  readonly faultPlace: boolean;
  readonly addressFallback: "loopback" | null;
  readonly logLevel: LogLevel;
};

export type LogLevel = "debug" | "info" | "warn" | "error";

// Why a setting stops the start. Reasons never carry the value.
export type SettingProblem = { readonly setting: string; readonly reason: "missing" | "invalid" | "notAllowedHere" };

export class SettingsError extends Error {
  readonly problems: readonly SettingProblem[];
  constructor(problems: readonly SettingProblem[]) {
    super(`Refusing to start: ${problems.map((problem) => `${problem.setting} ${problem.reason}`).join(", ")}`);
    this.name = "SettingsError";
    this.problems = problems;
  }
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const MODEL_PROVIDER_HOST = "api.anthropic.com";
const MIN_SECRET_BYTES = 32;

const isDevelopment = (env: AppEnv) => env === "local" || env === "test";

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

const raw = z.object({
  APP_ENV: z.enum(APP_ENVS),
  APP_ORIGIN: z.url(),
  KEY_HMAC_SECRET: z.string().refine((value) => new TextEncoder().encode(value).length >= MIN_SECRET_BYTES),
  IDENTITY_ADAPTER: z.enum(["seeded", "upstream"]),
  MODEL_MODE: z.enum(["off", "recorded", "live"]),
  MODEL_BASE_URL: z.string().default(""),
  MODEL_API_KEY: z.string().default(""),
  MODEL_NAME: z.string().default(""),
  CLOCK_FIXED: z.union([z.literal(""), z.iso.datetime()]).default(""),
  FAULT_SEND: z.enum(["", "on"]).default(""),
  FAULT_PLACE: z.enum(["", "on"]).default(""),
  ADDRESS_FALLBACK: z.enum(["", "loopback"]).default(""),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});
type Raw = z.infer<typeof raw>;

function environmentProblems(values: Raw, hasDatabase: boolean): SettingProblem[] {
  const env = values.APP_ENV;
  const development = isDevelopment(env);
  const problems: SettingProblem[] = [];
  const refuse = (setting: string, reason: SettingProblem["reason"] = "notAllowedHere") =>
    problems.push({ setting, reason });
  const originHost = hostOf(values.APP_ORIGIN) as string;
  if (development !== LOOPBACK_HOSTS.has(originHost)) refuse("APP_ORIGIN");
  if (!development && !values.APP_ORIGIN.startsWith("https://")) refuse("APP_ORIGIN");
  if ((env === "production") !== (values.IDENTITY_ADAPTER === "upstream")) refuse("IDENTITY_ADAPTER");
  if (development ? values.MODEL_MODE === "live" : values.MODEL_MODE === "recorded") refuse("MODEL_MODE");
  if (values.MODEL_MODE === "recorded" && !LOOPBACK_HOSTS.has(hostOf(values.MODEL_BASE_URL) ?? ""))
    refuse("MODEL_BASE_URL");
  if (development && values.MODEL_API_KEY !== "") refuse("MODEL_API_KEY");
  if (values.MODEL_MODE === "live") {
    if (!values.MODEL_BASE_URL.startsWith(`https://${MODEL_PROVIDER_HOST}`)) refuse("MODEL_BASE_URL");
    if (values.MODEL_API_KEY === "") refuse("MODEL_API_KEY", "missing");
  }
  if (values.MODEL_MODE !== "off" && values.MODEL_NAME === "") refuse("MODEL_NAME", "missing");
  for (const setting of ["CLOCK_FIXED", "FAULT_SEND", "FAULT_PLACE"] as const) {
    if (!development && values[setting] !== "") refuse(setting);
  }
  // The local dev server sets cf-connecting-ip itself, so only the test runner may fall back.
  if (env !== "test" && values.ADDRESS_FALLBACK !== "") refuse("ADDRESS_FALLBACK");
  if (!development && values.LOG_LEVEL !== "info") refuse("LOG_LEVEL");
  // Each environment's D1 database is named in its own wrangler environment. Production has no
  // database in this release, so it cannot start.
  if (!hasDatabase) refuse("DB", "missing");
  else if (env === "production") refuse("DB");
  return problems;
}

function modelSettings(values: Raw): ModelSettings {
  if (values.MODEL_MODE === "off") return { mode: "off" };
  if (values.MODEL_MODE === "recorded")
    return { mode: "recorded", baseUrl: values.MODEL_BASE_URL, name: values.MODEL_NAME };
  return { mode: "live", baseUrl: values.MODEL_BASE_URL, apiKey: values.MODEL_API_KEY, name: values.MODEL_NAME };
}

// Reads the Worker's settings once at start. Any problem refuses the start and names the
// setting, never its value.
export function parseSettings(source: Readonly<Record<string, unknown>>, hasDatabase: boolean): Settings {
  const parsed = raw.safeParse(source);
  if (!parsed.success) {
    throw new SettingsError(
      parsed.error.issues.map((issue) => ({
        setting: String(issue.path[0]),
        reason: source[String(issue.path[0])] === undefined ? "missing" : "invalid",
      })),
    );
  }
  const values = parsed.data;
  const problems = environmentProblems(values, hasDatabase);
  if (problems.length > 0) throw new SettingsError(problems);
  return {
    appEnv: values.APP_ENV,
    appOrigin: new URL(values.APP_ORIGIN).origin,
    keyHmacSecret: values.KEY_HMAC_SECRET,
    identityAdapter: values.IDENTITY_ADAPTER,
    model: modelSettings(values),
    clockFixedMs: values.CLOCK_FIXED === "" ? null : Date.parse(values.CLOCK_FIXED),
    faultSend: values.FAULT_SEND === "on",
    faultPlace: values.FAULT_PLACE === "on",
    addressFallback: values.ADDRESS_FALLBACK === "" ? null : "loopback",
    logLevel: values.LOG_LEVEL,
  };
}
