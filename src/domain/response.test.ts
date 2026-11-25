import { describe, expect, test } from "vitest";
import { monthOf, monthSpan, type ResponseRow, responseByAgency } from "./response";

const MINUTE = 60_000;
const row = (regencyCode: string, seen: number | null, taken: number | null): ResponseRow => ({
  regencyCode,
  sentMs: 1_000_000,
  seenMs: seen === null ? null : 1_000_000 + seen * MINUTE,
  takenMs: taken === null ? null : 1_000_000 + taken * MINUTE,
});

describe("how fast an agency answers", () => {
  test("is its median and nine in ten, in whole minutes, with what nobody saw or took counted apart", () => {
    const reports = [10, 1, 4, 2, 3].map((seen) => row("11.08", seen, seen === 10 ? null : seen * 10));
    expect(responseByAgency([...reports, row("11.08", null, null)])).toEqual([
      {
        regencyCode: "11.08",
        reports: 6,
        figures: {
          seen: { count: 5, median: 3, p90: 10 },
          taken: { count: 4, median: 20, p90: 40 },
          notSeen: 1,
          notTaken: 2,
          dropped: 0,
        },
      },
    ]);
  });

  test("rounds to the nearest minute", () => {
    const reports = Array.from({ length: 5 }, () => ({ ...row("11.08", null, null), seenMs: 1_000_000 + 89_999 }));
    expect(responseByAgency(reports)[0]?.figures?.seen).toEqual({ count: 5, median: 1, p90: 1 });
    const longer = reports.map((report) => ({ ...report, seenMs: 1_000_000 + 90_000 }));
    expect(responseByAgency(longer)[0]?.figures?.seen?.median).toBe(2);
  });

  test("a gap that ran backwards is left out and counted; one at once is kept", () => {
    const reports = [
      row("11.08", -1, 0),
      row("11.08", 0, -2),
      row("11.08", 5, 5),
      row("11.08", 6, 6),
      row("11.08", 7, 7),
    ];
    expect(responseByAgency(reports)[0]?.figures).toEqual({
      seen: { count: 4, median: 5, p90: 7 },
      taken: { count: 4, median: 5, p90: 7 },
      notSeen: 0,
      notTaken: 0,
      dropped: 2,
    });
  });

  test("says nothing under 5 reports, and nothing of what never happened", () => {
    const four = Array.from({ length: 4 }, () => row("12.01", 1, 1));
    expect(responseByAgency(four)).toEqual([{ regencyCode: "12.01", reports: 4, figures: null }]);
    const unseen = Array.from({ length: 5 }, () => row("12.01", null, null));
    expect(responseByAgency(unseen)[0]?.figures).toMatchObject({ seen: null, taken: null, notSeen: 5, notTaken: 5 });
    expect(responseByAgency([])).toEqual([]);
  });

  test("each agency stands alone, in the order of its code", () => {
    const codes = responseByAgency([row("12.01", 1, 1), row("11.08", 1, 1), row("12.01", 2, 2)]);
    expect(codes.map((one) => [one.regencyCode, one.reports])).toEqual([
      ["11.08", 1],
      ["12.01", 2],
    ]);
  });
});

describe("a month", () => {
  test("runs from WIB midnight of its first day to the next month's", () => {
    expect(monthSpan("2026-11")).toEqual({
      fromMs: Date.parse("2026-10-31T17:00:00.000Z"),
      toMs: Date.parse("2026-11-30T17:00:00.000Z"),
    });
    expect(monthSpan("2026-12")?.toMs).toBe(Date.parse("2026-12-31T17:00:00.000Z"));
    expect(monthSpan("2026-01")?.fromMs).toBe(Date.parse("2025-12-31T17:00:00.000Z"));
  });

  test.each(["", "2026", "2026-00", "2026-13", "2026-1", "x2026-11", "2026-11-01"])("%s is none", (text) => {
    expect(monthSpan(text)).toBeNull();
  });

  test("an instant's is the one in WIB", () => {
    expect(monthOf(Date.parse("2026-10-31T16:59:59.000Z"))).toBe("2026-10");
    expect(monthOf(Date.parse("2026-10-31T17:00:00.000Z"))).toBe("2026-11");
  });
});
