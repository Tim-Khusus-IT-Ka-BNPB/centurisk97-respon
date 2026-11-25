import { describe, expect, test } from "vitest";
import { emergencyStates, isVictimAnswer, oneTapDayOpensAt, oneTapOpensAt, VICTIM_ANSWERS } from "./emergency";
import type { FieldStates } from "./fieldState";

const NOW = Date.parse("2026-11-24T03:05:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe("what was said of victims", () => {
  test("is yes, no or not known, and nothing else", () => {
    expect(VICTIM_ANSWERS).toEqual(["yes", "no", "unknown"]);
    for (const answer of VICTIM_ANSWERS) expect(isVictimAnswer(answer)).toBe(true);
    for (const other of ["maybe", "", undefined, null]) expect(isVictimAnswer(other)).toBe(false);
  });
});

describe("an emergency when it is sent", () => {
  const place = { state: "notYetKnown" } as const;

  test("is happening now, in the place's own clock, and its kind is the system's not-known", () => {
    const states: FieldStates = { place, hazardType: { state: "value", value: "flood", origin: "tappedOption" } };
    expect(emergencyStates(states, NOW, "WIT")).toEqual({
      ...states,
      hazardSubtype: { state: "value", value: "unknown", origin: "system" },
      eventTime: {
        state: "value",
        value: { kind: "dateTime", localDate: "2026-11-24", localTime: "12:05", zone: "WIT" },
        origin: "system",
      },
    });
  });

  test("with no hazard told, has no kind of it either", () => {
    for (const states of [{ place }, { place, hazardType: { state: "notYetKnown" } }] as FieldStates[])
      expect(emergencyStates(states, NOW, "WIB").hazardSubtype).toBeUndefined();
  });
});

describe("one tap", () => {
  test("opens again for a phone 30 minutes after its last", () => {
    expect(oneTapOpensAt(null, NOW)).toBeNull();
    expect(oneTapOpensAt(NOW, NOW)).toBe(NOW + 30 * MINUTE);
    expect(oneTapOpensAt(NOW - 30 * MINUTE + 1, NOW)).toBe(NOW + 1);
    expect(oneTapOpensAt(NOW - 30 * MINUTE, NOW)).toBeNull();
  });

  test("is 3 a day for a number, the next a day after the first of the last three", () => {
    expect(oneTapDayOpensAt([], NOW)).toBeNull();
    expect(oneTapDayOpensAt([NOW - 3 * HOUR, NOW - HOUR], NOW)).toBeNull();
    expect(oneTapDayOpensAt([NOW - 3 * HOUR, NOW - 2 * HOUR, NOW - HOUR], NOW)).toBe(NOW + 21 * HOUR);
    expect(oneTapDayOpensAt([NOW - 9 * HOUR, NOW - 3 * HOUR, NOW - 2 * HOUR, NOW - HOUR], NOW)).toBe(NOW + 21 * HOUR);
    // One a day old or more no longer counts.
    expect(oneTapDayOpensAt([NOW - 24 * HOUR, NOW - 2 * HOUR, NOW - HOUR], NOW)).toBeNull();
    expect(oneTapDayOpensAt([NOW - 24 * HOUR + 1, NOW - 2 * HOUR, NOW - HOUR], NOW)).toBe(NOW + 1);
  });
});
