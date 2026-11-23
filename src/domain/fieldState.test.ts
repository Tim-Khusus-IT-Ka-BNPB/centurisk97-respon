import { describe, expect, test } from "vitest";
import { countOf, countState, isSettled, readCountBox } from "./fieldState";

describe("number box", () => {
  test("a whole number is a count, 0 included", () => {
    expect(readCountBox("12", 100)).toEqual({ kind: "count", count: 12 });
    expect(readCountBox(" 007 ", 100)).toEqual({ kind: "count", count: 7 });
    expect(readCountBox("0", 100)).toEqual({ kind: "count", count: 0 });
  });

  test("empty or only spaces is empty, never zero", () => {
    expect(readCountBox("", 100)).toEqual({ kind: "empty" });
    expect(readCountBox("   ", 100)).toEqual({ kind: "empty" });
  });

  test("the maximum passes and one over is refused", () => {
    expect(readCountBox("100", 100)).toEqual({ kind: "count", count: 100 });
    expect(readCountBox("101", 100)).toEqual({ kind: "error", rule: "tooLarge" });
  });

  test("presence without a number asks for the number", () => {
    expect(readCountBox("ada", 100)).toEqual({ kind: "error", rule: "countNeeded" });
    expect(readCountBox("ADA", 100)).toEqual({ kind: "error", rule: "countNeeded" });
  });

  test("anything but digits is not a whole number", () => {
    for (const typed of ["1.250", "2,5", "-1", "+3", "3 orang", "ada 2", "tidak ada", "x12"]) {
      expect(readCountBox(typed, 100_000)).toEqual({ kind: "error", rule: "wholeNumber" });
    }
  });
});

describe("count states", () => {
  test("zero becomes none and a positive count a value", () => {
    expect(countState(0, "boxEntry")).toStrictEqual({ state: "none", origin: "boxEntry" });
    expect(countState(3, "boxEntry")).toStrictEqual({ state: "value", value: 3, origin: "boxEntry" });
    expect(countState(0, "quote", "tidak ada korban jiwa")).toStrictEqual({
      state: "none",
      origin: "quote",
      quote: "tidak ada korban jiwa",
    });
    expect(countState(3, "quote", "tiga rumah")).toStrictEqual({
      state: "value",
      value: 3,
      origin: "quote",
      quote: "tiga rumah",
    });
  });

  test("the count a state stands for", () => {
    expect(countOf({ state: "none", origin: "boxEntry" })).toBe(0);
    expect(countOf({ state: "value", value: 4, origin: "boxEntry" })).toBe(4);
    expect(countOf({ state: "value", value: "flood", origin: "tappedOption" })).toBeNull();
    expect(countOf({ state: "notYetKnown" })).toBeNull();
    expect(countOf({ state: "confirmedUnknown", origin: "boxEntry" })).toBeNull();
    expect(countOf(undefined)).toBeNull();
  });

  test("settled means value, none or confirmed unknown", () => {
    expect(isSettled({ state: "value", value: 1, origin: "boxEntry" })).toBe(true);
    expect(isSettled({ state: "none", origin: "boxEntry" })).toBe(true);
    expect(isSettled({ state: "confirmedUnknown", origin: "boxEntry" })).toBe(true);
    expect(isSettled({ state: "notYetKnown" })).toBe(false);
    expect(isSettled(undefined)).toBe(false);
  });
});
