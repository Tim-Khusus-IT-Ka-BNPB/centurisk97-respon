import { describe, expect, test } from "vitest";
import { isOverdue, OVERDUE_MS, periodStart } from "./deskQueue";

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

describe("a ticket left in one status", () => {
  test("is late after a week, while open; a closed or invalid one never is", () => {
    const now = Date.UTC(2026, 10, 27);
    expect(OVERDUE_MS).toBe(604_800_000);
    for (const status of ["new", "seen", "under_review", "forwarded", "in_handling"] as const) {
      expect(isOverdue(status, now - OVERDUE_MS, now), status).toBe(false);
      expect(isOverdue(status, now - OVERDUE_MS - 1, now), status).toBe(true);
    }
    for (const status of ["closed", "invalid"] as const) expect(isOverdue(status, 0, now), status).toBe(false);
  });
});
