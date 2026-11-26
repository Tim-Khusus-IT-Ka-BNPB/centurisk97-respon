import { describe, expect, test } from "vitest";
import { type AggregateInput, aggregateRows, isoWeek } from "./aggregates";
import { MINUTE_MS } from "./time";

const T = Date.UTC(2026, 10, 18, 3);
const report = (numberKey: string, minutes: number, extra: Partial<AggregateInput> = {}): AggregateInput => ({
  provinceCode: "31",
  provinceName: "DKI Jakarta",
  regencyCode: "31.75",
  regencyName: "Kota Jakarta Timur",
  hazardType: "flood",
  eventMs: T,
  sentMs: T + minutes * MINUTE_MS,
  numberKey,
  placedPhoto: false,
  status: "new",
  ...extra,
});

describe("weekly aggregates", () => {
  test("the ISO week is read on the WIB date", () => {
    expect(isoWeek(Date.UTC(2026, 10, 19, 3))).toBe("2026-W47");
    // Sunday 4 January at 18.00 UTC is Monday 5 January in WIB: week 2.
    expect(isoWeek(Date.UTC(2026, 0, 4, 18))).toBe("2026-W02");
    expect(isoWeek(Date.UTC(2026, 0, 4, 16, 59))).toBe("2026-W01");
    expect(isoWeek(Date.UTC(2027, 0, 1, 0))).toBe("2026-W53");
    expect(isoWeek(Date.UTC(2025, 11, 29, 3))).toBe("2026-W01");
    expect(isoWeek(Date.UTC(2026, 11, 31, 3))).toBe("2026-W53");
  });

  test("a cell from fewer than 3 numbers says <3 and empties its details", () => {
    expect(aggregateRows([report("a", 10), report("b", 20), report("a", 30)])).toEqual([
      {
        week: "2026-W47",
        provinceCode: "31",
        provinceName: "DKI Jakarta",
        regencyCode: "31.75",
        regencyName: "Kota Jakarta Timur",
        hazardType: "flood",
        reports: "<3",
        reporters: "<3",
        placedPhotos: null,
        invalid: null,
        medianMinutesToReport: null,
      },
    ]);
  });

  test("from 3 numbers the cell opens; the median counts only reports with an event time", () => {
    const rows = aggregateRows([
      report("a", 10),
      report("b", 20),
      report("c", 40, { placedPhoto: true, status: "invalid" }),
      report("c", 5, { eventMs: null }),
    ]);
    expect(rows[0]).toMatchObject({ reports: 4, reporters: 3, placedPhotos: 1, invalid: 1, medianMinutesToReport: 20 });
  });

  test("an even count takes the middle two, rounded; a send before its event time is left out", () => {
    const rows = aggregateRows([report("a", 10), report("b", 21), report("c", 30), report("d", 50), report("e", -5)]);
    expect(rows[0]?.medianMinutesToReport).toBe(26);
    expect(aggregateRows([report("a", -1), report("b", -2), report("c", -3)])[0]?.medianMinutesToReport).toBeNull();
  });

  test("the median is of the sorted delays, a send at the event time counting as 0", () => {
    expect(aggregateRows([report("a", 50), report("b", 10), report("c", 30)])[0]?.medianMinutesToReport).toBe(30);
    expect(aggregateRows([report("a", 0), report("b", 0), report("c", 90)])[0]?.medianMinutesToReport).toBe(0);
  });

  test("cells split by week, regency and hazard, in that order", () => {
    const week = 7 * 24 * 60;
    const rows = aggregateRows([
      ...["a", "b", "c"].map((key) => report(key, 0, { hazardType: "landslide" })),
      ...["a", "b", "c"].map((key) => report(key, 0, { regencyCode: "31.74", regencyName: "Kota Jakarta Selatan" })),
      ...["a", "b", "c"].map((key) => report(key, 0, { eventMs: T - week * MINUTE_MS })),
      ...["a", "b", "c"].map((key) => report(key, 0)),
    ]);
    expect(rows.map((row) => `${row.week} ${row.regencyCode} ${row.hazardType} ${row.reports}`)).toEqual([
      "2026-W46 31.75 flood 3",
      "2026-W47 31.74 flood 3",
      "2026-W47 31.75 flood 3",
      "2026-W47 31.75 landslide 3",
    ]);
  });
});
