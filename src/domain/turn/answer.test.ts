import { describe, expect, test } from "vitest";
import type { FieldState, FieldStates, PlaceValue } from "../fieldState";
import { type AnswerContext, applyAnswer, type CardAnswer } from "./answer";
import { type DraftContent, EMPTY_CONTENT, type Question } from "./content";

const NOW = Date.parse("2026-11-23T03:00:00.000Z");
const context: AnswerContext = {
  nowMs: NOW,
  zone: "WIB",
  reporter: { name: "Uji Satu", number: "+6280000000001" },
  phraseOf: (key) => `phrase ${key.split(".").slice(-2, -1)[0]}`,
};
const tapped = (value: string): FieldState => ({ state: "value", value, origin: "tappedOption" });
const village: PlaceValue = {
  villageCode: "11.08.01.2001",
  precision: "villageLevel",
  snapshotId: 1,
  villageName: "Sukamaju",
  districtName: "B",
  regencyName: "C",
  provinceName: "D",
};
const with_ = (states: FieldStates, extra: Partial<DraftContent> = {}): DraftContent => ({
  ...EMPTY_CONTENT,
  states,
  ...extra,
});
const answer = (optionIds: string[] = [], values: Record<string, string> = {}): CardAnswer => ({ optionIds, values });
const apply = (
  question: Question,
  given: CardAnswer,
  content: DraftContent = EMPTY_CONTENT,
  asked = {},
  place: PlaceValue | null = null,
) => applyAnswer(question, given, content, asked, context, place);
const states = (result: ReturnType<typeof apply>) => (result.kind === "applied" ? result.content.states : null);
const flood = { hazardType: tapped("flood") };

describe("place and RT/RW", () => {
  test("a picked village is the place; no village found names the place field; options are stale", () => {
    expect(states(apply({ kind: "place" }, answer(), EMPTY_CONTENT, {}, village))).toEqual({
      place: { state: "value", value: village, origin: "tappedOption" },
    });
    expect(apply({ kind: "place" }, answer())).toEqual({
      kind: "invalid",
      errors: [{ fieldId: "villageCode", rule: "required", params: { label: "field.place.label" } }],
    });
    expect(apply({ kind: "place" }, answer(["x"]), EMPTY_CONTENT, {}, village)).toEqual({ kind: "stale" });
  });

  test("1 to 3 digits each, Tidak tahu, or both empty as not known", () => {
    const rtrw = { kind: "neighbourhood" } as const;
    expect(states(apply(rtrw, answer([], { rt: " 004 ", rw: "12" })))?.neighbourhood).toEqual({
      state: "value",
      value: { rt: "004", rw: "12" },
      origin: "boxEntry",
    });
    expect(states(apply(rtrw, answer([], { rt: "", rw: "7" })))?.neighbourhood).toEqual({
      state: "value",
      value: { rt: null, rw: "7" },
      origin: "boxEntry",
    });
    expect(states(apply(rtrw, answer([], { rt: "3" })))?.neighbourhood).toEqual({
      state: "value",
      value: { rt: "3", rw: null },
      origin: "boxEntry",
    });
    expect(states(apply(rtrw, answer(["unknown"], { rt: "5" })))?.neighbourhood).toEqual({
      state: "confirmedUnknown",
      origin: "tappedOption",
    });
    expect(states(apply(rtrw, answer([], {})))?.neighbourhood).toEqual({
      state: "confirmedUnknown",
      origin: "boxEntry",
    });
    expect(apply(rtrw, answer([], { rt: "1234", rw: "a" }))).toEqual({
      kind: "invalid",
      errors: [
        { fieldId: "rt", rule: "digits", params: { label: "field.neighbourhood.rt" } },
        { fieldId: "rw", rule: "digits", params: { label: "field.neighbourhood.rw" } },
      ],
    });
    expect(apply(rtrw, answer(["unknown", "x"]))).toEqual({ kind: "stale" });
    expect(apply(rtrw, answer(["x"]))).toEqual({ kind: "stale" });
  });
});

describe("choices", () => {
  const hazard = { kind: "choice", fieldId: "hazardType" } as const;
  test("one hazard type is stored as tapped; none, two, or an unknown id are refused or stale", () => {
    expect(states(apply(hazard, answer(["landslide"])))).toEqual({ hazardType: tapped("landslide") });
    expect(apply(hazard, answer([]))).toEqual({
      kind: "invalid",
      errors: [{ fieldId: "hazardType", rule: "required", params: { label: "field.hazardType.label" } }],
    });
    expect(apply(hazard, answer(["flood", "landslide"]))).toEqual({ kind: "stale" });
    expect(apply(hazard, answer(["other"]))).toEqual({ kind: "stale" });
  });

  test("a changed type drops its subtype, its chronology and values the new type does not ask", () => {
    const before = with_(
      {
        hazardType: tapped("flood"),
        hazardSubtype: tapped("flashFlood"),
        chronology: {
          state: "value",
          value: { steps: [], otherText: {}, note: null, text: "" },
          origin: "tappedOption",
        },
        housesFlooded: { state: "none", origin: "boxEntry" },
        housesHeavy: { state: "value", value: 2, origin: "boxEntry" },
      },
      { chronology: { steps: [["a"]], otherText: {} } },
    );
    const changed = apply(hazard, answer(["drought"]), before);
    expect(changed.kind === "applied" && changed.content.states).toEqual({ hazardType: tapped("drought") });
    expect(changed.kind === "applied" && changed.content.chronology).toBeNull();
    const same = apply(hazard, answer(["flood"]), before);
    expect(same.kind === "applied" && Object.keys(same.content.states).sort()).toEqual([
      "chronology",
      "hazardSubtype",
      "hazardType",
      "housesFlooded",
      "housesHeavy",
    ]);
    expect(same.kind === "applied" && same.content.chronology).toEqual({ steps: [["a"]], otherText: {} });
    const first = apply(
      hazard,
      answer(["drought"]),
      with_({
        housesHeavy: { state: "value", value: 2, origin: "quote", quote: "dua rumah" },
        dead: { state: "none", origin: "boxEntry" },
      }),
    );
    expect(states(first)).toEqual({ dead: { state: "none", origin: "boxEntry" }, hazardType: tapped("drought") });
  });

  test("a subtype, Tidak tahu included, is a value; a single choice none or unknown is that state", () => {
    expect(
      states(apply({ kind: "choice", fieldId: "hazardSubtype" }, answer(["unknown"]), with_(flood)))?.hazardSubtype,
    ).toEqual(tapped("unknown"));
    const farmland = { kind: "choice", fieldId: "farmland" } as const;
    expect(states(apply(farmland, answer(["none"]), with_(flood)))?.farmland).toEqual({
      state: "none",
      origin: "tappedOption",
    });
    expect(states(apply(farmland, answer(["unknown"]), with_(flood)))?.farmland).toEqual({
      state: "confirmedUnknown",
      origin: "tappedOption",
    });
    expect(states(apply(farmland, answer(["oneToTenHectares"]), with_(flood)))?.farmland).toEqual(
      tapped("oneToTenHectares"),
    );
    expect(
      states(apply({ kind: "choice", fieldId: "waterDepth" }, answer(["unknown"]), with_(flood)))?.waterDepth,
    ).toEqual({ state: "confirmedUnknown", origin: "tappedOption" });
  });

  test("several picks are one value; an exclusive one with others names both; Lainnya needs its own words", () => {
    const groups = { kind: "multiChoice", fieldId: "vulnerableGroups" } as const;
    expect(states(apply(groups, answer(["elderly", "disabled"])))?.vulnerableGroups).toEqual({
      state: "value",
      value: { optionIds: ["elderly", "disabled"], otherText: null },
      origin: "tappedOption",
    });
    expect(apply(groups, answer(["elderly", "none"]))).toEqual({
      kind: "invalid",
      errors: [
        {
          fieldId: "vulnerableGroups",
          rule: "exclusiveWithOthers",
          params: { label: "field.vulnerableGroups.label", option: "option.vulnerableGroups.none.label" },
        },
      ],
    });
    expect(states(apply(groups, answer(["none"])))?.vulnerableGroups).toEqual({
      state: "none",
      origin: "tappedOption",
    });
    const needs = { kind: "multiChoice", fieldId: "urgentNeeds" } as const;
    expect(apply(needs, answer(["other"]))).toEqual({
      kind: "invalid",
      errors: [{ fieldId: "other", rule: "required", params: { label: "option.urgentNeeds.other.label" } }],
    });
    expect(apply(needs, answer(["other"], { other: "a".repeat(121) }))).toEqual({
      kind: "invalid",
      errors: [
        {
          fieldId: "other",
          rule: "text.tooLong",
          params: { label: "option.urgentNeeds.other.label", length: 121, max: 120 },
        },
      ],
    });
    expect(
      states(apply(needs, answer(["foodParcels", "other"], { other: "selimut untuk Uji Satu" })))?.urgentNeeds,
    ).toEqual({
      state: "value",
      value: { optionIds: ["foodParcels", "other"], otherText: "selimut untuk [nama pelapor]" },
      origin: "tappedOption",
    });
    expect(states(apply(needs, answer(["other"], { other: "a".repeat(120) })))?.urgentNeeds).toMatchObject({
      state: "value",
    });
  });
});

describe("a reopened group", () => {
  test("marks the fields of each answered card done, but not a single chronology step", () => {
    const overlay = { kind: "edit", groupId: "victims", done: [] } as const;
    const victims = {
      kind: "numberForm",
      groupId: "victims",
      fieldIds: ["dead", "missing", "injured"],
      askedBefore: false,
    } as const;
    const saved = apply(victims, answer(["allNone"]), with_({}, { overlay }));
    expect(saved.kind === "applied" && saved.content.overlay).toEqual({
      ...overlay,
      done: ["dead", "missing", "injured"],
    });
    const stepped = apply(
      { kind: "chronologyStep", step: 0 },
      answer(["heavyRain"]),
      with_(flood, { overlay: { kind: "edit", groupId: "event", done: [] } }),
    );
    expect(stepped.kind === "applied" && stepped.content.overlay).toEqual({ kind: "edit", groupId: "event", done: [] });
  });

  test("an answer on the summary or the cancel confirm is stale", () => {
    expect(apply({ kind: "summary" }, answer(["x"]))).toEqual({ kind: "stale" });
    expect(apply({ kind: "cancelConfirm" }, answer())).toEqual({ kind: "stale" });
  });
});
