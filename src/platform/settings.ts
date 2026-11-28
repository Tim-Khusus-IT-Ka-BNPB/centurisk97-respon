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
  readonly identityAdapter: "seeded" | "auth";
  // Where staff sign in, for the auth adapter (centurisk97-auth); null for the seeded one.
  readonly auth: { readonly issuer: string; readonly clientId: string; readonly clientSecret: string } | null;
  readonly model: ModelSettings;
  readonly clockFixedMs: number | null;
  readonly faultSend: boolean;
  readonly faultPlace: boolean;
  readonly todayPage: boolean;
  readonly addressFallback: "loopback" | null;
  // The VAPID pair the warnings are signed with, and who the push services may write to. Null:
  // warnings are shut.
  readonly push: { readonly publicKey: string; readonly privateKey: string; readonly subject: string } | null;
  // Where photos and videos live (decision 0015 in centurisk97-platform). Null on one's own machine
  // and in tests with no S3: a bucket in memory.
  readonly s3: {
    readonly endpoint: string;
    readonly region: string;
    readonly bucket: string;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  } | null;
  readonly databaseUrl: string;
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
  IDENTITY_ADAPTER: z.enum(["seeded", "auth"]),
  AUTH_ISSUER: z.union([z.literal(""), z.url()]).default(""),
  AUTH_CLIENT_ID: z.string().default(""),
  AUTH_CLIENT_SECRET: z.string().default(""),
  MODEL_MODE: z.enum(["off", "recorded", "live"]),
  MODEL_BASE_URL: z.string().default(""),
  MODEL_API_KEY: z.string().default(""),
  MODEL_NAME: z.string().default(""),
  CLOCK_FIXED: z.union([z.literal(""), z.iso.datetime()]).default(""),
  FAULT_SEND: z.enum(["", "on"]).default(""),
  FAULT_PLACE: z.enum(["", "on"]).default(""),
  // The public today page (upstream LAPOR_HARI_INI): off unless "on"; off, its page and API answer 404.
  TODAY_PAGE: z.enum(["", "on"]).default(""),
  ADDRESS_FALLBACK: z.enum(["", "loopback"]).default(""),
  // base64url: an uncompressed P-256 point, its private scalar, and a contact the push services accept.
  PUSH_PUBLIC_KEY: z.union([z.literal(""), z.string().regex(/^B[A-Za-z0-9_-]{86}$/)]).default(""),
  PUSH_PRIVATE_KEY: z.union([z.literal(""), z.string().regex(/^[A-Za-z0-9_-]{43}$/)]).default(""),
  PUSH_SUBJECT: z.union([z.literal(""), z.string().regex(/^(mailto:|https:\/\/)\S+$/)]).default(""),
  // The module's own database and role (decision 0014 in centurisk97-platform).
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\/\S+$/),
  S3_ENDPOINT: z.union([z.literal(""), z.url()]).default(""),
  S3_REGION: z.string().min(1).default("garage"),
  S3_BUCKET: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/)
    .default("respon-files"),
  S3_ACCESS_KEY_ID: z.string().default(""),
  S3_SECRET_ACCESS_KEY: z.string().default(""),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});
type Raw = z.infer<typeof raw>;

function environmentProblems(values: Raw): SettingProblem[] {
  const env = values.APP_ENV;
  const development = isDevelopment(env);
  const problems: SettingProblem[] = [];
  const refuse = (setting: string, reason: SettingProblem["reason"] = "notAllowedHere") =>
    problems.push({ setting, reason });
  const originHost = hostOf(values.APP_ORIGIN) as string;
  if (development !== LOOPBACK_HOSTS.has(originHost)) refuse("APP_ORIGIN");
  if (!development && !values.APP_ORIGIN.startsWith("https://")) refuse("APP_ORIGIN");
  // Production signs staff in through auth; the seeded codes are for local, test and staging only.
  if (env === "production" && values.IDENTITY_ADAPTER !== "auth") refuse("IDENTITY_ADAPTER");
  if (values.IDENTITY_ADAPTER === "auth") {
    if (values.AUTH_ISSUER === "") refuse("AUTH_ISSUER", "missing");
    else if (
      !values.AUTH_ISSUER.startsWith("https://") &&
      !(development && LOOPBACK_HOSTS.has(hostOf(values.AUTH_ISSUER) as string))
    )
      refuse("AUTH_ISSUER");
    if (values.AUTH_CLIENT_ID === "") refuse("AUTH_CLIENT_ID", "missing");
    if (new TextEncoder().encode(values.AUTH_CLIENT_SECRET).length < MIN_SECRET_BYTES)
      refuse("AUTH_CLIENT_SECRET", "missing");
  }
  // Tests never call the provider; a person's own machine may (owner, 2026-11-25), staging and
  // production never use the recorded stub.
  if (env === "test" ? values.MODEL_MODE === "live" : !development && values.MODEL_MODE === "recorded")
    refuse("MODEL_MODE");
  if (values.MODEL_MODE === "recorded" && !LOOPBACK_HOSTS.has(hostOf(values.MODEL_BASE_URL) ?? ""))
    refuse("MODEL_BASE_URL");
  if (env === "test" && values.MODEL_API_KEY !== "") refuse("MODEL_API_KEY");
  if (values.MODEL_MODE === "live") {
    if (!values.MODEL_BASE_URL.startsWith(`https://${MODEL_PROVIDER_HOST}`)) refuse("MODEL_BASE_URL");
    if (values.MODEL_API_KEY === "") refuse("MODEL_API_KEY", "missing");
  }
  if (values.MODEL_MODE !== "off" && values.MODEL_NAME === "") refuse("MODEL_NAME", "missing");
  for (const setting of ["CLOCK_FIXED", "FAULT_SEND", "FAULT_PLACE"] as const) {
    if (!development && values[setting] !== "") refuse(setting);
  }
  // The Node server sets x-client-address itself, so only the test runner may fall back.
  if (env !== "test" && values.ADDRESS_FALLBACK !== "") refuse("ADDRESS_FALLBACK");
  if (!development && values.LOG_LEVEL !== "info") refuse("LOG_LEVEL");
  // The three push settings come together or not at all.
  const push = [values.PUSH_PUBLIC_KEY, values.PUSH_PRIVATE_KEY, values.PUSH_SUBJECT];
  if (push.some((value) => value !== "") && push.some((value) => value === ""))
    for (const setting of ["PUSH_PUBLIC_KEY", "PUSH_PRIVATE_KEY", "PUSH_SUBJECT"] as const)
      if (values[setting] === "") refuse(setting, "missing");
  // Files go to S3 everywhere but one's own machine and the tests, which may keep them in memory.
  if (values.S3_ENDPOINT === "") {
    if (!development) refuse("S3_ENDPOINT", "missing");
  } else {
    if (values.S3_ACCESS_KEY_ID === "") refuse("S3_ACCESS_KEY_ID", "missing");
    if (values.S3_SECRET_ACCESS_KEY === "") refuse("S3_SECRET_ACCESS_KEY", "missing");
  }
  return problems;
}

function modelSettings(values: Raw): ModelSettings {
  if (values.MODEL_MODE === "off") return { mode: "off" };
  if (values.MODEL_MODE === "recorded")
    return { mode: "recorded", baseUrl: values.MODEL_BASE_URL, name: values.MODEL_NAME };
  return { mode: "live", baseUrl: values.MODEL_BASE_URL, apiKey: values.MODEL_API_KEY, name: values.MODEL_NAME };
}

// Reads the settings once at start. Any problem refuses the start and names the setting, never
// its value.
export function parseSettings(source: Readonly<Record<string, unknown>>): Settings {
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
  const problems = environmentProblems(values);
  if (problems.length > 0) throw new SettingsError(problems);
  return {
    appEnv: values.APP_ENV,
    appOrigin: new URL(values.APP_ORIGIN).origin,
    keyHmacSecret: values.KEY_HMAC_SECRET,
    identityAdapter: values.IDENTITY_ADAPTER,
    auth:
      values.IDENTITY_ADAPTER === "auth"
        ? { issuer: values.AUTH_ISSUER, clientId: values.AUTH_CLIENT_ID, clientSecret: values.AUTH_CLIENT_SECRET }
        : null,
    model: modelSettings(values),
    clockFixedMs: values.CLOCK_FIXED === "" ? null : Date.parse(values.CLOCK_FIXED),
    faultSend: values.FAULT_SEND === "on",
    faultPlace: values.FAULT_PLACE === "on",
    todayPage: values.TODAY_PAGE === "on",
    addressFallback: values.ADDRESS_FALLBACK === "" ? null : "loopback",
    push:
      values.PUSH_PUBLIC_KEY === ""
        ? null
        : { publicKey: values.PUSH_PUBLIC_KEY, privateKey: values.PUSH_PRIVATE_KEY, subject: values.PUSH_SUBJECT },
    s3:
      values.S3_ENDPOINT === ""
        ? null
        : {
            endpoint: values.S3_ENDPOINT,
            region: values.S3_REGION,
            bucket: values.S3_BUCKET,
            accessKeyId: values.S3_ACCESS_KEY_ID,
            secretAccessKey: values.S3_SECRET_ACCESS_KEY,
          },
    databaseUrl: values.DATABASE_URL,
    logLevel: values.LOG_LEVEL,
  };
}
