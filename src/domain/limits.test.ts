import { describe, expect, test } from "vitest";
import {
  BACK_STEPS,
  isOverLimit,
  LENGTHS,
  LIMIT_IDS,
  LIMITS,
  limitCopyKey,
  retryAt,
  rollingRetryAt,
  windowStart,
} from "./limits";

describe("limits table", () => {
  test("rows as agreed", () => {
    expect(LIMITS).toMatchSnapshot();
    expect(LENGTHS).toMatchSnapshot();
    expect(BACK_STEPS).toBe(12);
  });

  test("each row passes at its limit and refuses one over", () => {
    for (const id of LIMIT_IDS) {
      expect(isOverLimit(id, LIMITS[id].max)).toBe(false);
      expect(isOverLimit(id, LIMITS[id].max + 1)).toBe(true);
    }
    expect(isOverLimit("message.minute", 20)).toBe(false);
    expect(isOverLimit("message.minute", 21)).toBe(true);
    expect(isOverLimit("send.rolling", 6)).toBe(true);
  });

  test("copy keys follow the limit id", () => {
    expect(limitCopyKey("address.draftReads")).toBe("limit.address.draftReads");
  });
});

describe("windows and retry times", () => {
  const at = Date.UTC(2026, 10, 23, 16, 59, 42, 500);

  test("minute and clock hour", () => {
    expect(windowStart("minute", at)).toBe(Date.UTC(2026, 10, 23, 16, 59));
    expect(retryAt("minute", at)).toBe(Date.UTC(2026, 10, 23, 17, 0));
    expect(windowStart("clockHour", at)).toBe(Date.UTC(2026, 10, 23, 16));
    expect(retryAt("clockHour", at)).toBe(Date.UTC(2026, 10, 23, 17));
  });

  test("the WIB day starts at 17.00 UTC the day before", () => {
    expect(windowStart("wibDay", at)).toBe(Date.UTC(2026, 10, 22, 17));
    expect(retryAt("wibDay", at)).toBe(Date.UTC(2026, 10, 23, 17));
    const justAfterMidnightWib = Date.UTC(2026, 10, 23, 17, 0, 0, 1);
    expect(windowStart("wibDay", justAfterMidnightWib)).toBe(Date.UTC(2026, 10, 23, 17));
  });

  test("a window start is itself inside the window", () => {
    const start = Date.UTC(2026, 10, 23, 5);
    expect(windowStart("clockHour", start)).toBe(start);
    expect(windowStart("minute", start)).toBe(start);
  });

  test("the rolling send limit frees a send 24 hours after the oldest", () => {
    expect(rollingRetryAt(Date.UTC(2026, 10, 23, 1, 2, 3))).toBe(Date.UTC(2026, 10, 24, 1, 2, 3));
  });
});
