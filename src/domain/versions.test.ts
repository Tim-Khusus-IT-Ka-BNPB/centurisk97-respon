import { describe, expect, test } from "vitest";
import type { FieldStates } from "./fieldState";
import { versionChanges } from "./versions";

const count = (value: number, origin: "boxEntry" | "tappedOption" = "boxEntry") =>
  ({ state: "value", value, origin }) as const;
const chronology = (text: string, steps: string[][]) =>
  ({
    state: "value",
    origin: "tappedOption",
    value: { steps, otherText: {}, note: null, text },
  }) as const;

describe("what a later version says that an earlier one did not", () => {
  test("values are compared by what they say, in the order they are asked", () => {
    const before: FieldStates = {
      urgentNeeds: { state: "value", origin: "tappedOption", value: { optionIds: ["food"], otherText: null } },
      dead: count(3),
      missing: { state: "none", origin: "boxEntry" },
      injured: { state: "notYetKnown" },
    };
    const after: FieldStates = {
      urgentNeeds: { state: "value", origin: "tappedOption", value: { optionIds: ["food", "water"], otherText: null } },
      dead: { state: "value", value: 2, origin: "officer", quote: "Dicek" },
      missing: count(1),
      injured: { state: "none", origin: "boxEntry" },
    };
    expect(versionChanges(before, after)).toEqual([
      { fieldId: "dead", from: before.dead, to: after.dead },
      { fieldId: "missing", from: before.missing, to: after.missing },
      { fieldId: "injured", from: before.injured, to: after.injured },
      { fieldId: "urgentNeeds", from: before.urgentNeeds, to: after.urgentNeeds },
    ]);
  });

  test("where a value came from is no change, nor is one way of not knowing for another", () => {
    const before: FieldStates = { dead: count(3), missing: { state: "notYetKnown" }, injured: undefined };
    const after: FieldStates = {
      dead: count(3, "tappedOption"),
      missing: { state: "confirmedUnknown", origin: "boxEntry" },
      injured: { state: "notYetKnown" },
    };
    expect(versionChanges(before, after)).toEqual([]);
  });

  test("a value no longer there is a change, and none is not the same as nothing known", () => {
    expect(versionChanges({ dead: count(3) }, {})).toEqual([{ fieldId: "dead", from: count(3), to: undefined }]);
    expect(versionChanges({}, { dead: { state: "none", origin: "boxEntry" } })).toHaveLength(1);
    // A none is not a value that reads "none".
    expect(
      versionChanges(
        { shelters: { state: "none", origin: "boxEntry" } },
        { shelters: { state: "value", value: "none", origin: "boxEntry" } },
      ),
    ).toHaveLength(1);
  });

  test("a chronology is its sentences", () => {
    expect(
      versionChanges(
        { chronology: chronology("Air naik.", [["a"]]) },
        { chronology: chronology("Air naik.", [["b"]]) },
      ),
    ).toEqual([]);
    expect(
      versionChanges(
        { chronology: chronology("Air naik.", [["a"]]) },
        { chronology: chronology("Air surut.", [["a"]]) },
      ),
    ).toHaveLength(1);
  });

  test("a value with no text of its own is compared whole", () => {
    const at = (rt: string | null) => ({ state: "value", origin: "boxEntry", value: { rt, rw: null } }) as const;
    expect(versionChanges({ neighbourhood: at("1") }, { neighbourhood: at("2") })).toHaveLength(1);
    expect(versionChanges({ neighbourhood: at("1") }, { neighbourhood: at("1") })).toEqual([]);
  });
});
