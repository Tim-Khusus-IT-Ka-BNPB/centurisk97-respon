import { describe, expect, test } from "vitest";
import type { FieldState, FieldStates } from "./fieldState";
import {
  FOLLOW_UP,
  followUpClosesAt,
  followUpPhotos,
  followUpRefusal,
  isLocked,
  newsOf,
  openedBy,
  withNews,
} from "./followUp";
import { HOUR_MS } from "./time";

const SENT = Date.parse("2026-11-25T02:00:00.000Z");
const report = (more: Partial<Parameters<typeof followUpRefusal>[0]> = {}) => ({
  sentAtMs: SENT,
  status: "in_handling" as const,
  versions: 1,
  ...more,
});
const count = (value: number): FieldState => ({ state: "value", value, origin: "boxEntry" });
const none: FieldState = { state: "none", origin: "boxEntry" };
const hazard = (value: string): FieldState => ({ state: "value", value, origin: "tappedOption" });
const flood: FieldStates = { hazardType: hazard("flood"), hazardSubtype: hazard("unknown") };

describe("when news is taken", () => {
  test("up to and including the 72nd hour after sending", () => {
    expect(FOLLOW_UP).toEqual({ windowMs: 72 * HOUR_MS, versions: 10, photos: 20 });
    expect(followUpClosesAt(SENT)).toBe(Date.parse("2026-11-28T02:00:00.000Z"));
    expect(followUpRefusal(report(), SENT + 72 * HOUR_MS)).toBeNull();
    expect(followUpRefusal(report(), SENT + 72 * HOUR_MS + 1)).toBe("tooLate");
  });

  test("while the ticket is open, whatever the time", () => {
    for (const status of ["new", "seen", "under_review", "forwarded", "in_handling"] as const)
      expect(followUpRefusal(report({ status }), SENT)).toBeNull();
    for (const status of ["closed", "invalid"] as const) {
      expect(followUpRefusal(report({ status }), SENT)).toBe("ended");
      expect(followUpRefusal(report({ status }), SENT + 100 * HOUR_MS)).toBe("ended");
    }
  });

  test("up to ten versions in all", () => {
    expect(followUpRefusal(report({ versions: 9 }), SENT)).toBeNull();
    expect(followUpRefusal(report({ versions: 10 }), SENT)).toBe("tooMany");
  });

  test("photos: ten a time, twenty on a report", () => {
    expect([0, 9, 10, 11, 19, 20, 25].map(followUpPhotos)).toEqual([10, 10, 10, 9, 1, 0, 0]);
  });
});

describe("what news may change", () => {
  test("never the place, the time, or a hazard that is known", () => {
    const locked = ["place", "neighbourhood", "eventTime", "hazardType", "hazardSubtype"] as const;
    for (const fieldId of locked) expect(isLocked(flood, fieldId), fieldId).toBe(true);
    expect(isLocked(flood, "chronology")).toBe(false);
    expect(isLocked(flood, "dead")).toBe(false);
    // One tap told no hazard.
    const tap: FieldStates = { hazardType: { state: "notYetKnown" } };
    expect(locked.map((fieldId) => isLocked(tap, fieldId))).toEqual([true, true, true, false, false]);
  });

  test("is a value or a none that says something else; nothing empty takes a value back", () => {
    const base: FieldStates = { ...flood, dead: count(3), missing: count(1), injured: { state: "notYetKnown" } };
    expect(
      newsOf(base, {
        ...base,
        hazardType: hazard("landslide"),
        dead: count(4),
        missing: none,
        injured: none,
        displacedPeople: count(20),
      }),
    ).toEqual({ dead: count(4), missing: none, injured: none, displacedPeople: count(20) });
    expect(
      newsOf(base, {
        ...base,
        dead: { state: "notYetKnown" },
        missing: { state: "confirmedUnknown", origin: "boxEntry" },
        injured: { state: "confirmedUnknown", origin: "boxEntry" },
      }),
    ).toEqual({});
    const { dead: _gone, ...rest } = base;
    expect(newsOf(base, rest)).toEqual({});
    expect(newsOf({ hazardType: { state: "notYetKnown" } }, { hazardType: hazard("flood") })).toEqual({
      hazardType: hazard("flood"),
    });
  });

  test("goes onto the newest version value by value; what an officer put right meanwhile is kept", () => {
    const corrected: FieldState = { state: "value", value: 2, origin: "officer", quote: "Dicek" };
    const latest: FieldStates = { ...flood, dead: corrected, missing: count(1) };
    expect(withNews(latest, { displacedPeople: count(30), missing: none })).toStrictEqual({
      ...flood,
      dead: corrected,
      missing: none,
      displacedPeople: count(30),
    });
  });

  test("a count told as none takes the values asked only under it with it", () => {
    const latest: FieldStates = {
      ...flood,
      injured: count(5),
      injuredInpatient: count(2),
      schools: count(1),
      schoolNames: { state: "value", value: "SD Contoh", origin: "boxEntry" },
    };
    expect(withNews(latest, { injured: none })).toEqual({
      ...flood,
      injured: none,
      schools: count(1),
      schoolNames: latest.schoolNames,
    });
  });

  test("opens the fields it makes apply, once each", () => {
    const base: FieldStates = { ...flood, injured: none, schools: count(1) };
    expect(openedBy(base, { ...base, injured: count(4) })).toEqual(["injuredInpatient"]);
    expect(openedBy(base, { ...base, injured: count(4), injuredInpatient: { state: "notYetKnown" } })).toEqual([]);
    // Open before and left unasked is not opened by the news.
    expect(openedBy(base, { ...base, dead: count(1) })).toEqual([]);
    const tap: FieldStates = { hazardType: { state: "notYetKnown" } };
    expect(openedBy(tap, { hazardType: hazard("flood") })).toEqual(["housesFlooded", "waterDepth", "farmland"]);
  });
});
