import { describe, expect, test } from "vitest";
import { periodStart } from "./deskQueue";

// 24 Nov 2026 09.30 WIB.
const NOW = Date.parse("2026-11-24T02:30:00Z");

describe("queue periods", () => {
  test("today starts at WIB midnight", () => {
    expect(new Date(periodStart("today", NOW) as number).toISOString()).toBe("2026-11-23T17:00:00.000Z");
  });

  test("a week is today and the six WIB days before it", () => {
    expect(new Date(periodStart("week", NOW) as number).toISOString()).toBe("2026-11-17T17:00:00.000Z");
  });

  test("a month is today and the 29 WIB days before it", () => {
    expect(new Date(periodStart("month", NOW) as number).toISOString()).toBe("2026-10-25T17:00:00.000Z");
  });

  test("all has no start", () => {
    expect(periodStart("all", NOW)).toBeNull();
  });

  test("just after WIB midnight is already the new day", () => {
    expect(new Date(periodStart("today", Date.parse("2026-11-23T17:00:01Z")) as number).toISOString()).toBe(
      "2026-11-23T17:00:00.000Z",
    );
  });
});
