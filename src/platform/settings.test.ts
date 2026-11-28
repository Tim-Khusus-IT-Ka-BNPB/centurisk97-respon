import { describe, expect, test } from "vitest";
import { parseSettings, SettingsError } from "./settings";

const SECRET = "local-sample-hmac-key-at-least-32-bytes-long";
const local = {
  APP_ENV: "local",
  APP_ORIGIN: "http://localhost:5173",
  KEY_HMAC_SECRET: SECRET,
  IDENTITY_ADAPTER: "seeded",
  MODEL_MODE: "off",
  MODEL_BASE_URL: "http://localhost:8790",
  MODEL_API_KEY: "",
  MODEL_NAME: "recorded",
  CLOCK_FIXED: "",
  FAULT_SEND: "",
  FAULT_PLACE: "",
  ADDRESS_FALLBACK: "",
  LOG_LEVEL: "info",
};
const staging = {
  ...local,
  APP_ENV: "staging",
  APP_ORIGIN: "https://staging.example.test",
  MODEL_BASE_URL: "",
  MODEL_NAME: "",
};

function refusal(source: Record<string, unknown>, hasDatabase = true) {
  try {
    parseSettings(source, hasDatabase);
  } catch (error) {
    if (error instanceof SettingsError) return { message: error.message, problems: error.problems };
    throw error;
  }
  throw new Error("settings were accepted");
}

describe("settings read at start", () => {
  test("the local sample starts", () => {
    expect(parseSettings(local, true)).toEqual({
      appEnv: "local",
      appOrigin: "http://localhost:5173",
      keyHmacSecret: SECRET,
      identityAdapter: "seeded",
      auth: null,
      model: { mode: "off" },
      clockFixedMs: null,
      faultSend: false,
      faultPlace: false,
      addressFallback: null,
      gatewaySecrets: new Map(),
      push: null,
      todayPage: false,
      logLevel: "info",
    });
  });

  test("the three push settings come together, each of its shape, or warnings stay shut", () => {
    const push = {
      PUSH_PUBLIC_KEY: `B${"A".repeat(86)}`,
      PUSH_PRIVATE_KEY: "a".repeat(43),
      PUSH_SUBJECT: "mailto:peringatan@example.test",
    };
    expect(parseSettings({ ...staging, ...push }, true).push).toEqual({
      publicKey: push.PUSH_PUBLIC_KEY,
      privateKey: push.PUSH_PRIVATE_KEY,
      subject: push.PUSH_SUBJECT,
    });
    expect(parseSettings({ ...local, ...push, PUSH_SUBJECT: "https://example.test" }, true).push?.subject).toBe(
      "https://example.test",
    );
    expect(refusal({ ...local, PUSH_PUBLIC_KEY: push.PUSH_PUBLIC_KEY }).problems).toEqual([
      { setting: "PUSH_PRIVATE_KEY", reason: "missing" },
      { setting: "PUSH_SUBJECT", reason: "missing" },
    ]);
    expect(refusal({ ...local, ...push, PUSH_PUBLIC_KEY: "" }).problems).toEqual([
      { setting: "PUSH_PUBLIC_KEY", reason: "missing" },
    ]);
    for (const [setting, value] of [
      ["PUSH_PUBLIC_KEY", `A${"A".repeat(86)}`],
      ["PUSH_PUBLIC_KEY", `B${"A".repeat(85)}`],
      ["PUSH_PRIVATE_KEY", "a".repeat(42)],
      ["PUSH_PRIVATE_KEY", `${"a".repeat(42)}=`],
      ["PUSH_SUBJECT", "peringatan@example.test"],
      ["PUSH_SUBJECT", "http://example.test"],
    ] as const)
      expect(refusal({ ...local, ...push, [setting]: value }).problems, value).toEqual([
        { setting, reason: "invalid" },
      ]);
  });

  test("each WhatsApp gateway has a secret of its own, of 32 characters or more", () => {
    const secrets = (text: string) => parseSettings({ ...local, GATEWAY_SECRETS: text }, true).gatewaySecrets;
    expect(secrets("")).toEqual(new Map());
    const [first, second] = ["a".repeat(32), "b".repeat(40)];
    expect(secrets(`mini-1=${first}  mini-2=${second}`)).toEqual(
      new Map([
        ["mini-1", first],
        ["mini-2", second],
      ]),
    );
    for (const text of [
      `mini-1=${"a".repeat(31)}`,
      `mini-1=${first} mini-1=${second}`,
      first as string,
      `m=${first}`,
      `${"m".repeat(41)}=${first}`,
      `Mini=${first}`,
      `x mini-1=${first}`,
      `mini-1=${first}=x`,
    ])
      expect(refusal({ ...local, GATEWAY_SECRETS: text }).problems, text).toEqual([
        { setting: "GATEWAY_SECRETS", reason: "invalid" },
      ]);
    expect(parseSettings({ ...staging, GATEWAY_SECRETS: `mini-1=${first}` }, true).gatewaySecrets.size).toBe(1);
  });

  test("a missing setting is named and its value never shown", () => {
    const { APP_ORIGIN: _, ...rest } = local;
    const result = refusal({ ...rest, KEY_HMAC_SECRET: "short-secret-value" });
    expect(result.problems).toEqual([
      { setting: "APP_ORIGIN", reason: "missing" },
      { setting: "KEY_HMAC_SECRET", reason: "invalid" },
    ]);
    expect(result.message).toBe("Refusing to start: APP_ORIGIN missing, KEY_HMAC_SECRET invalid");
    expect(result.message).not.toContain("short-secret-value");
  });

  test("the secret needs 32 bytes", () => {
    expect(parseSettings({ ...local, KEY_HMAC_SECRET: "x".repeat(32) }, true).keyHmacSecret).toHaveLength(32);
    expect(refusal({ ...local, KEY_HMAC_SECRET: "x".repeat(31) }).problems).toEqual([
      { setting: "KEY_HMAC_SECRET", reason: "invalid" },
    ]);
  });

  test("the today page opens only on its switch", () => {
    expect(parseSettings({ ...local, TODAY_PAGE: "on" }, true).todayPage).toBe(true);
    expect(() => parseSettings({ ...local, TODAY_PAGE: "yes" }, true)).toThrow();
  });

  test("development switches are read in local and test", () => {
    const settings = parseSettings(
      {
        ...local,
        APP_ENV: "test",
        CLOCK_FIXED: "2026-11-23T01:00:00.000Z",
        FAULT_SEND: "on",
        FAULT_PLACE: "on",
        ADDRESS_FALLBACK: "loopback",
        LOG_LEVEL: "debug",
        MODEL_MODE: "recorded",
      },
      true,
    );
    expect(settings).toMatchObject({
      appEnv: "test",
      clockFixedMs: Date.UTC(2026, 10, 23, 1),
      faultSend: true,
      faultPlace: true,
      addressFallback: "loopback",
      logLevel: "debug",
      model: { mode: "recorded", baseUrl: "http://localhost:8790", name: "recorded" },
    });
  });

  test("local refuses a remote origin and the address fallback; a live model needs the provider host", () => {
    expect(
      refusal({
        ...local,
        MODEL_MODE: "live",
        MODEL_API_KEY: "sk-test-not-a-real-key",
        APP_ORIGIN: "https://example.test",
        ADDRESS_FALLBACK: "loopback",
      }).problems.map((problem) => problem.setting),
    ).toEqual(["APP_ORIGIN", "MODEL_BASE_URL", "ADDRESS_FALLBACK"]);
  });

  test("a person's own machine may use the live model with its key", () => {
    const live = { ...local, MODEL_MODE: "live", MODEL_BASE_URL: "https://api.anthropic.com", MODEL_API_KEY: "k" };
    expect(parseSettings({ ...live, MODEL_NAME: "claude-sonnet-5-5" }, true).model).toEqual({
      mode: "live",
      baseUrl: "https://api.anthropic.com",
      apiKey: "k",
      name: "claude-sonnet-5-5",
    });
  });

  test("tests never call the provider and hold no key", () => {
    expect(
      refusal({
        ...local,
        APP_ENV: "test",
        MODEL_MODE: "live",
        MODEL_BASE_URL: "https://api.anthropic.com",
        MODEL_API_KEY: "k",
      }).problems.map((problem) => problem.setting),
    ).toEqual(["MODEL_MODE", "MODEL_API_KEY"]);
  });

  test("a recorded model must be a local stub with a name", () => {
    expect(
      refusal({ ...local, MODEL_MODE: "recorded", MODEL_BASE_URL: "https://api.anthropic.com", MODEL_NAME: "" })
        .problems,
    ).toEqual([
      { setting: "MODEL_BASE_URL", reason: "notAllowedHere" },
      { setting: "MODEL_NAME", reason: "missing" },
    ]);
    expect(refusal({ ...local, MODEL_MODE: "recorded", MODEL_BASE_URL: "not a url" }).problems).toEqual([
      { setting: "MODEL_BASE_URL", reason: "notAllowedHere" },
    ]);
  });

  test("staging refuses development switches, a debug log and the recorded model", () => {
    expect(
      refusal(
        {
          ...staging,
          CLOCK_FIXED: "2026-11-23T01:00:00.000Z",
          FAULT_SEND: "on",
          FAULT_PLACE: "on",
          LOG_LEVEL: "debug",
          MODEL_MODE: "recorded",
          MODEL_BASE_URL: "http://localhost:8790",
          MODEL_NAME: "recorded",
        },
        false,
      ).problems,
    ).toEqual([
      { setting: "MODEL_MODE", reason: "notAllowedHere" },
      { setting: "CLOCK_FIXED", reason: "notAllowedHere" },
      { setting: "FAULT_SEND", reason: "notAllowedHere" },
      { setting: "FAULT_PLACE", reason: "notAllowedHere" },
      { setting: "LOG_LEVEL", reason: "notAllowedHere" },
      { setting: "DB", reason: "missing" },
    ]);
  });

  test("staging needs https on its own host", () => {
    expect(refusal({ ...staging, APP_ORIGIN: "http://staging.example.test" }).problems).toEqual([
      { setting: "APP_ORIGIN", reason: "notAllowedHere" },
    ]);
    expect(refusal({ ...staging, APP_ORIGIN: "https://localhost" }).problems.map((p) => p.setting)).toEqual([
      "APP_ORIGIN",
    ]);
  });

  test("a live model needs the provider host and a key", () => {
    expect(
      refusal({ ...staging, MODEL_MODE: "live", MODEL_BASE_URL: "https://model.example.test" }, false).problems,
    ).toEqual([
      { setting: "MODEL_BASE_URL", reason: "notAllowedHere" },
      { setting: "MODEL_API_KEY", reason: "missing" },
      { setting: "MODEL_NAME", reason: "missing" },
      { setting: "DB", reason: "missing" },
    ]);
  });

  test("production signs staff in through auth and has no database in this release", () => {
    expect(refusal({ ...staging, APP_ENV: "production", APP_ORIGIN: "https://example.test" }).problems).toEqual([
      { setting: "IDENTITY_ADAPTER", reason: "notAllowedHere" },
      { setting: "DB", reason: "notAllowedHere" },
    ]);
    expect(refusal({ ...local, IDENTITY_ADAPTER: "upstream" }).problems.map((p) => p.setting)).toEqual([
      "IDENTITY_ADAPTER",
    ]);
  });

  test("signing in through auth needs auth's address and respon's client", () => {
    expect(refusal({ ...staging, IDENTITY_ADAPTER: "auth" }).problems).toEqual([
      { setting: "AUTH_ISSUER", reason: "missing" },
      { setting: "AUTH_CLIENT_ID", reason: "missing" },
      { setting: "AUTH_CLIENT_SECRET", reason: "missing" },
    ]);
    const signIn = { IDENTITY_ADAPTER: "auth", AUTH_CLIENT_ID: "respon", AUTH_CLIENT_SECRET: SECRET };
    expect(parseSettings({ ...staging, ...signIn, AUTH_ISSUER: "https://auth.example.test" }, true).auth).toEqual({
      issuer: "https://auth.example.test",
      clientId: "respon",
      clientSecret: SECRET,
    });
    expect(parseSettings(local, true).auth).toBeNull();
  });

  test("auth over plain http only on one's own machine", () => {
    const signIn = { IDENTITY_ADAPTER: "auth", AUTH_CLIENT_ID: "respon", AUTH_CLIENT_SECRET: SECRET };
    expect(parseSettings({ ...local, ...signIn, AUTH_ISSUER: "http://127.0.0.1:3100" }, true).auth).toMatchObject({
      issuer: "http://127.0.0.1:3100",
    });
    const plain = { setting: "AUTH_ISSUER", reason: "notAllowedHere" };
    expect(refusal({ ...local, ...signIn, AUTH_ISSUER: "http://auth.example.test" }).problems).toEqual([plain]);
    expect(refusal({ ...staging, ...signIn, AUTH_ISSUER: "http://127.0.0.1:3100" }).problems).toEqual([plain]);
  });

  test("defaults for optional settings", () => {
    const {
      MODEL_BASE_URL,
      MODEL_API_KEY,
      MODEL_NAME,
      CLOCK_FIXED,
      FAULT_SEND,
      FAULT_PLACE,
      ADDRESS_FALLBACK,
      LOG_LEVEL,
      ...required
    } = local;
    expect(parseSettings(required, true)).toMatchObject({
      logLevel: "info",
      faultSend: false,
      model: { mode: "off" },
    });
  });

  test("a live model starts in staging with its database", () => {
    const live = {
      ...staging,
      MODEL_MODE: "live",
      MODEL_BASE_URL: "https://api.anthropic.com",
      MODEL_API_KEY: "k",
      MODEL_NAME: "m",
    };
    expect(parseSettings(live, true).model).toEqual({
      mode: "live",
      baseUrl: "https://api.anthropic.com",
      apiKey: "k",
      name: "m",
    });
  });

  test("no environment starts without its database", () => {
    expect(refusal(local, false).problems).toEqual([{ setting: "DB", reason: "missing" }]);
  });
});
