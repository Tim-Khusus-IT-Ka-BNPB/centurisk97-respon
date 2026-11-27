import { describe, expect, test } from "vitest";
import type { Impact } from "./impact";
import {
  impactRanges,
  shownToday,
  TODAY_CONDITIONS,
  TODAY_WINDOW_MS,
  type TodayCheck,
  type TodayReport,
  todayConditions,
  toTheHour,
  verifiedAtMs,
} from "./todayPage";

const VILLAGE = "11.08.04.2019";
const check = (fields: Partial<TodayCheck> = {}): TodayCheck => ({
  id: 1,
  result: "valid",
  atMs: 1000,
  role: "regionalOfficer",
  level: "regency",
  code: "11.08",
  ...fields,
});
const report = (fields: Partial<TodayReport> = {}): TodayReport => ({
  villageCode: VILLAGE,
  status: "in_handling",
  checks: [check()],
  versionsAtMs: [500],
  pulls: [],
  ...fields,
});
const failing = (one: TodayReport) => TODAY_CONDITIONS.filter((condition) => !todayConditions(one)[condition]);

describe("the today page's five conditions", () => {
  test("a last check Valid by the BPBD of the report's regency or province, ticket not invalid, unchanged, not pulled", () => {
    expect(TODAY_CONDITIONS).toEqual(["valid", "bpbd", "ticket", "version", "pull"]);
    expect(failing(report())).toEqual([]);
    expect(verifiedAtMs(report())).toBe(1000);
    expect(failing(report({ checks: [check({ level: "province", code: "11" })] }))).toEqual([]);
    // A version made by the check itself, at its own time, is not after it.
    expect(failing(report({ versionsAtMs: [500, 1000] }))).toEqual([]);
  });

  test("each condition fails on its own", () => {
    expect(failing(report({ checks: [check({ result: "partly" })] }))).toEqual(["valid", "bpbd"]);
    expect(failing(report({ checks: [] }))).toEqual(["valid", "bpbd"]);
    for (const by of [
      { role: "deskOfficer", level: "national", code: null },
      { level: "regency", code: "11.07" },
      { level: "province", code: "12" },
      { level: "national", code: null },
      { role: null, level: null, code: null },
      { role: "deskOfficer", level: "regency", code: "11.08" },
      { level: "province", code: "11.08" },
      { level: "regency", code: "11" },
    ])
      expect(failing(report({ checks: [check(by)] })), JSON.stringify(by)).toEqual(["bpbd"]);
    expect(failing(report({ status: "invalid" }))).toEqual(["ticket"]);
    expect(failing(report({ versionsAtMs: [500, 1001] }))).toEqual(["version"]);
    expect(failing(report({ pulls: [{ id: 1, pulled: true }] }))).toEqual(["pull"]);
    expect(
      failing(
        report({
          pulls: [
            { id: 2, pulled: false },
            { id: 1, pulled: true },
          ],
        }),
      ),
    ).toEqual([]);
    expect(
      failing(
        report({
          pulls: [
            { id: 1, pulled: false },
            { id: 2, pulled: true },
          ],
        }),
      ),
    ).toEqual(["pull"]);
    // Of two rows with one id, the first read stands.
    expect(
      failing(
        report({
          pulls: [
            { id: 1, pulled: true },
            { id: 1, pulled: false },
          ],
        }),
      ),
    ).toEqual(["pull"]);
    expect(verifiedAtMs(report({ status: "invalid" }))).toBeNull();
  });

  test("the last check counts: by time, then by its order when two share a time", () => {
    const later = check({ id: 2, atMs: 2000, result: "notValid" });
    expect(failing(report({ checks: [later, check()] }))).toEqual(["valid", "bpbd"]);
    expect(failing(report({ checks: [check({ id: 3 }), check({ id: 2, result: "partly" })] }))).toEqual([]);
    expect(failing(report({ checks: [check({ id: 2, result: "partly" }), check({ id: 3 })] }))).toEqual([]);
    expect(failing(report({ checks: [check({ id: 3, result: "partly" }), check({ id: 2 })] }))).toEqual([
      "valid",
      "bpbd",
    ]);
    // A later time wins over a higher order, either way round.
    expect(failing(report({ checks: [check({ id: 5 }), check({ id: 2, atMs: 2000, result: "notValid" })] }))).toEqual([
      "valid",
      "bpbd",
    ]);
    expect(failing(report({ checks: [check({ id: 1, atMs: 2000, result: "notValid" }), check({ id: 2 })] }))).toEqual([
      "valid",
      "bpbd",
    ]);
    expect(failing(report({ checks: [check({ id: 2 }), check({ id: 2, result: "partly" })] }))).toEqual([]);
    // With no check, no version is after it.
    expect(todayConditions(report({ checks: [], versionsAtMs: [9e15] })).version).toBe(true);
  });

  test("shown for 24 hours after it was verified", () => {
    expect(TODAY_WINDOW_MS).toBe(86_400_000);
    expect(shownToday(1000, 1000 + TODAY_WINDOW_MS - 1)).toBe(true);
    expect(shownToday(1000, 1000 + TODAY_WINDOW_MS)).toBe(false);
    expect(shownToday(null, 0)).toBe(false);
  });
});

describe("what an event card says", () => {
  const impact = (fields: Partial<Impact>): Impact => ({
    dead: null,
    missing: null,
    injured: null,
    displaced: null,
    houses: null,
    ...fields,
  });

  test("each figure as a range across the reports, one nobody knows left out, never a sum", () => {
    expect(
      impactRanges([
        impact({ dead: 2, houses: { count: 10, partial: false } }),
        impact({ dead: 3, injured: 0 }),
        impact({ dead: 1, houses: { count: 4, partial: true } }),
      ]),
    ).toEqual({ dead: { min: 1, max: 3 }, injured: { min: 0, max: 0 }, houses: { min: 4, max: 10 } });
    expect(impactRanges([impact({ missing: 5, displaced: 20 })])).toEqual({
      missing: { min: 5, max: 5 },
      displaced: { min: 20, max: 20 },
    });
    expect(impactRanges([])).toEqual({});
  });

  test("its time to the hour only", () => {
    expect(toTheHour({ kind: "dateTime", localDate: "2026-11-27", localTime: "08:47", zone: "WIB" })).toEqual({
      kind: "dateTime",
      localDate: "2026-11-27",
      localTime: "08:00",
      zone: "WIB",
    });
    expect(toTheHour({ kind: "dateOnly", localDate: "2026-11-27", zone: "WIB" })).toEqual({
      kind: "dateOnly",
      localDate: "2026-11-27",
      zone: "WIB",
    });
    expect(toTheHour(null)).toBeNull();
  });
});
