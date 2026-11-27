import { afterEach, describe, expect, test, vi } from "vitest";
import { createLogger, type LogLine } from "./index";

function capture(threshold: Parameters<typeof createLogger>[0] = "debug") {
  const lines: [string, LogLine][] = [];
  const logger = createLogger(threshold, (level, line) => lines.push([level, line]));
  return { logger, lines };
}

describe("the redacting logger", () => {
  afterEach(() => vi.restoreAllMocks());

  test("keeps allow-listed fields of the right shape", () => {
    const { logger, lines } = capture();
    logger.info({
      event: "request",
      requestId: "0b4c5d6e-7f80",
      routeId: "POST /api/drafts/:draftId/turns",
      method: "POST",
      status: 409,
      durationMs: 12,
      errorCode: "draft.changed",
      limitId: "message.minute",
      sqlState: "SQLITE_CONSTRAINT",
      draftState: "place_confirm",
      settings: ["APP_ORIGIN"],
    });
    expect(lines).toEqual([
      [
        "info",
        {
          event: "request",
          requestId: "0b4c5d6e-7f80",
          routeId: "POST /api/drafts/:draftId/turns",
          method: "POST",
          status: 409,
          durationMs: 12,
          errorCode: "draft.changed",
          limitId: "message.minute",
          sqlState: "SQLITE_CONSTRAINT",
          draftState: "place_confirm",
          settings: ["APP_ORIGIN"],
        },
      ],
    ]);
  });

  test("drops a name, a number, free text and unknown fields", () => {
    const { logger, lines } = capture();
    const smuggled = {
      event: "request",
      errorCode: "Uji Satu 0800 0000 0001",
      routeId: "GET /?number=080000000001 x",
      method: "TRACE",
      sqlState: "duplicate key",
      draftState: "Uji",
      requestId: "not hex!",
      status: Number.NaN,
      durationMs: "12",
      settings: ["APP_ORIGIN", "secret value", 3],
      name: "Uji Satu",
      body: "air masuk rumah",
    } as unknown as Parameters<typeof logger.info>[0];
    logger.info(smuggled);
    expect(lines).toEqual([["info", { event: "request", settings: ["APP_ORIGIN"] }]]);
    expect(JSON.stringify(lines)).not.toMatch(/Uji|0800|0000|rumah/);
  });

  test("an event name of the wrong shape is dropped too", () => {
    const { logger, lines } = capture();
    logger.info({ event: "Uji Satu" });
    expect(lines).toEqual([["info", {}]]);
  });

  test("levels below the threshold are not written", () => {
    const { logger, lines } = capture("warn");
    logger.debug({ event: "a" });
    logger.info({ event: "b" });
    logger.warn({ event: "c" });
    logger.error({ event: "d" });
    expect(lines.map(([level]) => level)).toEqual(["warn", "error"]);
  });

  test("the default sink writes one JSON line, errors and warnings to stderr", () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createLogger("debug");
    logger.debug({ event: "a" });
    logger.info({ event: "b" });
    logger.warn({ event: "c" });
    logger.error({ event: "d" });
    expect(out.mock.calls).toEqual([['{"level":"debug","event":"a"}'], ['{"level":"info","event":"b"}']]);
    expect(err.mock.calls).toEqual([['{"level":"warn","event":"c"}'], ['{"level":"error","event":"d"}']]);
  });
});
