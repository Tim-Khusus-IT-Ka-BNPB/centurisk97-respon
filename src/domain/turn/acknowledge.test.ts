import { describe, expect, test } from "vitest";
import type { FieldStates } from "../fieldState";
import { newlyChosenHazard, notedFacts, typedWords, withTranslation } from "./acknowledge";

const tapped = (value: string) => ({ state: "value", value, origin: "tappedOption" }) as const;
const quote = { origin: "quote", quote: "kata pelapor" } as const;

describe("what Sigap says it noted", () => {
  test("values read from words this turn, in the catalogue's order, a none as null", () => {
    const before: FieldStates = { injured: { state: "value", value: 4, ...quote } };
    const after: FieldStates = {
      urgentNeeds: { state: "value", value: { optionIds: ["readyMeals", "drinkingWater"], otherText: null }, ...quote },
      waterDepth: { state: "value", value: "chest", ...quote },
      housesFlooded: { state: "value", value: 50, ...quote },
      dead: { state: "none", ...quote },
      injured: { state: "value", value: 4, ...quote },
      shelters: { state: "value", value: "balai desa", ...quote },
    };
    expect(notedFacts(before, after)).toEqual([
      { field: "dead", value: null },
      { field: "shelters", value: "balai desa" },
      { field: "housesFlooded", value: 50 },
      { field: "waterDepth", value: "chest" },
      { field: "urgentNeeds", value: ["readyMeals", "drinkingWater"] },
    ]);
  });

  test("a value changed by words is noted again; tapped, typed or unknown ones are not", () => {
    const before: FieldStates = { dead: { state: "value", value: 1, ...quote } };
    expect(notedFacts(before, { dead: { state: "value", value: 2, ...quote } })).toEqual([{ field: "dead", value: 2 }]);
    expect(
      notedFacts(
        {},
        {
          hazardType: tapped("flood"),
          dead: { state: "value", value: 3, origin: "boxEntry" },
          missing: { state: "confirmedUnknown", ...quote },
          injured: { state: "notYetKnown" },
        },
      ),
    ).toEqual([]);
  });
});

describe("the safety line of a hazard type", () => {
  test("said once, when this turn chooses the type", () => {
    expect(newlyChosenHazard({}, { hazardType: tapped("flood") })).toBe("flood");
    expect(newlyChosenHazard({ hazardType: tapped("flood") }, { hazardType: tapped("landslide") })).toBeNull();
    expect(newlyChosenHazard({}, {})).toBeNull();
  });
});

describe("words typed on a card", () => {
  test("a text answer, an other answer or a chronology note, when it holds letters", () => {
    expect(
      typedWords({ kind: "textQuestion", fieldId: "shelters", askedBefore: false }, { shelters: " bale desa " }),
    ).toBe("bale desa");
    expect(typedWords({ kind: "multiChoice", fieldId: "urgentNeeds" }, { other: "sapi" })).toBe("sapi");
    expect(typedWords({ kind: "chronologyStep", step: 1 }, { other: "kali mbludak" })).toBe("kali mbludak");
    expect(typedWords({ kind: "chronologyReview" }, { note: "banyune teka cepet" })).toBe("banyune teka cepet");
    expect(typedWords({ kind: "chronologyReview" }, { other: "x", note: "" })).toBeNull();
    expect(
      typedWords({ kind: "textQuestion", fieldId: "shelters", askedBefore: false }, { shelters: "12 / 3" }),
    ).toBeNull();
    expect(typedWords({ kind: "textQuestion", fieldId: "shelters", askedBefore: false }, {})).toBeNull();
    expect(typedWords({ kind: "eventTime" }, { other: "wingi", note: "wingi" })).toBeNull();
    expect(typedWords({ kind: "choice", fieldId: "trapped" }, { other: "wingi" })).toBeNull();
  });

  test("a text answer keeps its Indonesian; anything else is left as it is", () => {
    const typed: FieldStates = { shelters: { state: "value", value: "bale desa", origin: "boxEntry" } };
    expect(withTranslation(typed, "shelters", "balai desa")).toEqual({
      shelters: { state: "value", value: "bale desa", origin: "boxEntry", translation: "balai desa" },
    });
    const count: FieldStates = { dead: { state: "value", value: 2, origin: "boxEntry" } };
    expect(withTranslation(count, "dead", "dua")).toBe(count);
    expect(withTranslation({}, "shelters", "x")).toEqual({});
    const unknown: FieldStates = { shelters: { state: "confirmedUnknown", origin: "boxEntry" } };
    expect(withTranslation(unknown, "shelters", "x")).toBe(unknown);
  });
});
