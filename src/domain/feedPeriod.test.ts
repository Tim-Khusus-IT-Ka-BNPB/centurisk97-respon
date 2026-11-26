import { describe, expect, test } from "vitest";
import { feedSince } from "./feedPeriod";

// 09.00 WIB on 27 November 2026; WIB midnight of that day is 26 Nov 17.00 UTC.
const NOW = Date.UTC(2026, 10, 27, 2);
const MIDNIGHT = Date.UTC(2026, 10, 26, 17);
const DAY = 86_400_000;

describe("the feed's period", () => {
  test("everything, or from WIB midnight of the latest report's day, or of 3 or 7 days back", () => {
    expect(feedSince("all", NOW, NOW)).toBeNull();
    expect(feedSince("latest", NOW, null)).toBeNull();
    expect(feedSince("latest", NOW, Date.UTC(2026, 10, 20, 16, 59))).toBe(Date.UTC(2026, 10, 19, 17));
    expect(feedSince("latest", NOW, Date.UTC(2026, 10, 20, 17))).toBe(Date.UTC(2026, 10, 20, 17));
    expect(feedSince("3", NOW, null)).toBe(MIDNIGHT - 2 * DAY);
    expect(feedSince("7", NOW, null)).toBe(MIDNIGHT - 6 * DAY);
  });
});
