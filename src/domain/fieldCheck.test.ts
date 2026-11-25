import { describe, expect, test } from "vitest";
import { CHECK_RESULTS, checkFieldCheck, REVISABLE, revisableOf, revised } from "./fieldCheck";
import type { FieldStates } from "./fieldState";

const box = { origin: "boxEntry" } as const;
const STATES: FieldStates = {
  hazardType: { state: "value", value: "flood", origin: "tappedOption" },
  dead: { state: "value", value: 3, ...box },
  missing: { state: "none", ...box },
  injured: { state: "notYetKnown" },
};
const NOTE = "Dicek ke kepala desa";
const check = (boxes: Record<string, string> = {}, result: (typeof CHECK_RESULTS)[number] = "partly", note = NOTE) =>
  checkFieldCheck(STATES, result, note, boxes);

describe("the figures an officer may put right", () => {
  test("are the report's own, with what each holds: 0 for a none, null when not known", () => {
    expect(revisableOf(STATES).map((one) => [one.fieldId, one.count])).toEqual([
      ["dead", 3],
      ["missing", 0],
      ["injured", null],
      ["displacedPeople", null],
      ["housesHeavy", null],
      ["housesModerate", null],
      ["housesLight", null],
      ["housesFlooded", null],
      ["schools", null],
      ["healthFacilities", null],
      ["worshipPlaces", null],
      ["roads", null],
    ]);
    expect(revisableOf(STATES)[0]).toEqual({ fieldId: "dead", unit: "people", max: 100_000, count: 3 });
    expect(REVISABLE).toHaveLength(12);
  });

  test("leave out what does not apply to the hazard", () => {
    const drought: FieldStates = {
      ...STATES,
      hazardType: { state: "value", value: "drought", origin: "tappedOption" },
    };
    const ids = revisableOf(drought).map((one) => one.fieldId);
    expect(ids).toContain("dead");
    expect(ids).not.toContain("housesHeavy");
  });
});

describe("a field check", () => {
  test("a box left empty or as it was changes nothing", () => {
    expect(check({ dead: "3", missing: "0", injured: "" })).toEqual({ kind: "ok", note: NOTE, changes: [] });
    expect(check()).toEqual({ kind: "ok", note: NOTE, changes: [] });
  });

  test("a figure put right is a change from what was there", () => {
    expect(check({ dead: "2", missing: "1", injured: "0" })).toEqual({
      kind: "ok",
      note: NOTE,
      changes: [
        { fieldId: "dead", from: 3, to: 2 },
        { fieldId: "missing", from: 0, to: 1 },
        { fieldId: "injured", from: null, to: 0 },
      ],
    });
  });

  test("what may not be put right here is not read", () => {
    expect(check({ hazardType: "2", affectedPeople: "9" })).toMatchObject({ changes: [] });
  });

  test.each([
    ["2,5", "wholeNumber"],
    ["ada", "countNeeded"],
    ["100001", "tooLarge"],
  ])("%s is refused on its box", (typed, rule) => {
    expect(check({ dead: typed })).toEqual({
      kind: "invalid",
      error: { fieldId: "dead", rule, params: { label: "field.dead.label", max: 100_000 } },
    });
  });

  test("only a report found partly right is put right", () => {
    expect(check({ dead: "2" }, "valid")).toEqual({
      kind: "invalid",
      error: { fieldId: "result", rule: "check.validWithChanges", params: {} },
    });
    expect(check({ dead: "2" }, "notValid")).toEqual({
      kind: "invalid",
      error: { fieldId: "result", rule: "check.notValidWithChanges", params: {} },
    });
    expect(check({}, "valid")).toMatchObject({ kind: "ok" });
    expect(check({}, "notValid")).toMatchObject({ kind: "ok" });
  });

  test("its note is trimmed and has 5 to 1,000 characters", () => {
    expect(check({}, "valid", "  Benar  ")).toMatchObject({ kind: "ok", note: "Benar" });
    expect(check({}, "valid", " Ada  ")).toEqual({
      kind: "invalid",
      error: { fieldId: "checkNote", rule: "staffText.tooShort", params: { label: "desk.check.note", min: 5 } },
    });
    expect(check({}, "valid", "a".repeat(1001))).toMatchObject({ kind: "invalid", error: { rule: "text.tooLong" } });
  });

  test("there are three results", () => {
    expect(CHECK_RESULTS).toEqual(["valid", "partly", "notValid"]);
  });
});

describe("a corrected report", () => {
  test("holds each correction with its note, a 0 as a none, and everything else as it was", () => {
    const next = revised(
      STATES,
      [
        { fieldId: "dead", from: 3, to: 2 },
        { fieldId: "injured", from: null, to: 0 },
      ],
      NOTE,
    );
    expect(next.states).toEqual({
      ...STATES,
      dead: { state: "value", value: 2, origin: "officer", quote: NOTE },
      injured: { state: "none", origin: "officer", quote: NOTE },
    });
    expect(STATES.dead).toMatchObject({ value: 3 });
    expect(next.completePercent).toBeGreaterThan(0);
  });

  test("is as complete as its values now are", () => {
    const before = revised(STATES, [], NOTE).completePercent;
    expect(revised(STATES, [{ fieldId: "injured", from: null, to: 1 }], NOTE).completePercent).toBeGreaterThan(before);
  });
});
