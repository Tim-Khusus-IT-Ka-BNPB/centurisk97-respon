import { describe, expect, test } from "vitest";
import type { FieldState, FieldStates } from "../fieldState";
import {
  type DraftContent,
  EMERGENCY_CONTENT,
  EMPTY_CONTENT,
  followUpContent,
  photoMax,
  type Question,
  questionFields,
} from "./content";
import { nextQuestion, stateFor } from "./next";
import { choiceOptions, isExclusiveOption } from "./options";

const tapped = (value: string): FieldState => ({ state: "value", value, origin: "tappedOption" });
const count = (value: number): FieldState => ({ state: "value", value, origin: "boxEntry" });
const none: FieldState = { state: "none", origin: "boxEntry" };
const unknown: FieldState = { state: "confirmedUnknown", origin: "tappedOption" };
const empty: FieldState = { state: "notYetKnown" };

const placed: FieldStates = {
  place: {
    state: "value",
    value: {
      villageCode: "11.08.01.2001",
      precision: "villageLevel",
      snapshotId: 1,
      villageName: "A",
      districtName: "B",
      regencyName: "C",
      provinceName: "D",
    },
    origin: "tappedOption",
  },
  neighbourhood: unknown,
};
const event: FieldStates = {
  ...placed,
  hazardType: tapped("flood"),
  hazardSubtype: tapped("riverOverflow"),
  chronology: { state: "value", value: { steps: [], otherText: {}, note: null, text: "" }, origin: "tappedOption" },
  eventTime: { state: "value", value: { kind: "olderThan30Days" }, origin: "tappedOption" },
};
// The photo step is done unless a test says otherwise, so a full draft reaches the summary.
const content = (states: FieldStates, extra: Partial<DraftContent> = {}): DraftContent => ({
  ...EMPTY_CONTENT,
  states,
  photosDone: "cannotSend",
  ...extra,
});
const next = (states: FieldStates, asked = {}, extra: Partial<DraftContent> = {}) =>
  nextQuestion("asking", content(states, extra), asked);

// Every field of a flood report settled except the ones given.
function floodAllBut(...open: string[]): FieldStates {
  const states: Record<string, FieldState> = { ...event };
  for (const id of [
    "dead",
    "missing",
    "injured",
    "affectedFamilies",
    "affectedPeople",
    "displacedPeople",
    "displacedFamilies",
    "housesHeavy",
    "housesModerate",
    "housesLight",
    "housesFlooded",
    "schools",
    "healthFacilities",
    "worshipPlaces",
    "roads",
  ])
    states[id] = none;
  for (const id of ["vulnerableGroups", "disruptedServices", "waterDepth", "farmland", "urgentNeeds"])
    states[id] = unknown;
  for (const id of open) delete states[id];
  return states;
}

describe("the next question, picked by code from the field table", () => {
  test("place first, then RT and RW, then the hazard type and its subtype", () => {
    expect(next({})).toEqual({ kind: "place" });
    expect(next({ place: placed.place as FieldState })).toEqual({ kind: "neighbourhood" });
    expect(next(placed)).toEqual({ kind: "choice", fieldId: "hazardType" });
    expect(next({ ...placed, hazardType: tapped("flood") })).toEqual({ kind: "choice", fieldId: "hazardSubtype" });
  });

  test("the guided chronology goes step by step and ends with its review", () => {
    const states = { ...placed, hazardType: tapped("flood"), hazardSubtype: tapped("riverOverflow") };
    expect(next(states)).toEqual({ kind: "chronologyStep", step: 0 });
    expect(next(states, {}, { chronology: { steps: [["heavyRain"], ["slowRise"]], otherText: {} } })).toEqual({
      kind: "chronologyStep",
      step: 2,
    });
    expect(next(states, {}, { chronology: { steps: Array.from({ length: 8 }, () => ["x"]), otherText: {} } })).toEqual({
      kind: "chronologyReview",
    });
  });

  test("counts of a group share one form; a follow-up is asked alone once its parent is above 0", () => {
    expect(next(event)).toEqual({
      kind: "numberForm",
      groupId: "victims",
      fieldIds: ["dead", "missing", "injured"],
      askedBefore: false,
    });
    expect(next({ ...event, dead: none, missing: none, injured: count(2) })).toEqual({
      kind: "numberForm",
      groupId: "victims",
      fieldIds: ["injuredInpatient"],
      askedBefore: false,
    });
    expect(next({ ...event, dead: none, missing: none, injured: none })).toEqual({
      kind: "numberForm",
      groupId: "affected",
      fieldIds: ["affectedFamilies", "affectedPeople"],
      askedBefore: false,
    });
  });

  test("text, single choice and multiple choice questions by kind", () => {
    expect(next(floodAllBut("shelters"))).toEqual({ kind: "summary" });
    expect(next({ ...floodAllBut(), displacedPeople: count(3) })).toEqual({
      kind: "textQuestion",
      fieldId: "shelters",
      askedBefore: false,
    });
    expect(next(floodAllBut("waterDepth"))).toEqual({ kind: "choice", fieldId: "waterDepth" });
    expect(next(floodAllBut("urgentNeeds"))).toEqual({ kind: "multiChoice", fieldId: "urgentNeeds" });
    expect(next(floodAllBut("eventTime"))).toEqual({ kind: "eventTime" });
  });

  test("a field left empty once is asked again after every unasked field, a second empty one is settled", () => {
    const states = { ...floodAllBut("urgentNeeds"), dead: empty, missing: empty };
    expect(next(states, { dead: 1, missing: 1 })).toEqual({ kind: "multiChoice", fieldId: "urgentNeeds" });
    const later = { ...states, urgentNeeds: unknown };
    expect(next(later, { dead: 1, missing: 1 })).toEqual({
      kind: "numberForm",
      groupId: "victims",
      fieldIds: ["dead", "missing"],
      askedBefore: true,
    });
    expect(next(later, { dead: 2, missing: 2 })).toEqual({ kind: "summary" });
    expect(next({ ...later, missing: none }, {})).toEqual({
      kind: "numberForm",
      groupId: "victims",
      fieldIds: ["dead"],
      askedBefore: true,
    });
    expect(next({ ...later, missing: none }, { dead: 1 })).toEqual({
      kind: "numberForm",
      groupId: "victims",
      fieldIds: ["dead"],
      askedBefore: true,
    });
    const text = { ...floodAllBut(), displacedPeople: count(2), shelters: empty };
    expect(next(text, { shelters: 1 })).toEqual({ kind: "textQuestion", fieldId: "shelters", askedBefore: true });
    expect(next(text, { shelters: 2 })).toEqual({ kind: "summary" });
  });

  test("a reopened group shows its fields whatever they hold, then returns to the summary", () => {
    const all = floodAllBut();
    const edit = (done: string[]) =>
      next(all, {}, { overlay: { kind: "edit", groupId: "victims", done: done as never } });
    expect(edit([])).toEqual({
      kind: "numberForm",
      groupId: "victims",
      fieldIds: ["dead", "missing", "injured"],
      askedBefore: false,
    });
    expect(edit(["dead", "missing", "injured"])).toEqual({ kind: "summary" });
    expect(
      next(
        { ...all, dead: empty },
        { dead: 1 },
        { overlay: { kind: "edit", groupId: "victims", done: ["dead", "missing", "injured"] } },
      ),
    ).toEqual({ kind: "summary" });
    const changedType = next(
      { ...floodAllBut("waterDepth") },
      {},
      { overlay: { kind: "edit", groupId: "event", done: ["hazardType", "hazardSubtype", "chronology", "eventTime"] } },
    );
    expect(changedType).toEqual({ kind: "choice", fieldId: "waterDepth" });
    const openCounts = next(
      floodAllBut("dead", "missing", "injured"),
      {},
      { overlay: { kind: "edit", groupId: "event", done: ["hazardType", "hazardSubtype", "chronology", "eventTime"] } },
    );
    expect(openCounts).toEqual({
      kind: "numberForm",
      groupId: "victims",
      fieldIds: ["dead", "missing", "injured"],
      askedBefore: false,
    });
    const event = next(all, {}, { overlay: { kind: "edit", groupId: "event", done: ["hazardType", "hazardSubtype"] } });
    expect(event).toEqual({ kind: "chronologyStep", step: 0 });
  });

  test("the cancel confirm stands over every question", () => {
    expect(next(event, {}, { overlay: { kind: "cancelConfirm" } })).toEqual({ kind: "cancelConfirm" });
  });

  test("the legacy type with no guided steps goes straight to the review", () => {
    expect(next({ ...placed, hazardType: tapped("other"), hazardSubtype: tapped("otherEvent") })).toEqual({
      kind: "chronologyReview",
    });
  });
});

describe("a new draft's content", () => {
  test("holds nothing", () => {
    expect(EMPTY_CONTENT).toEqual({ states: {}, chronology: null, guesses: [], overlay: null, danger: null });
  });
});

describe("the stored state of a question", () => {
  test.each<[Question, string]>([
    [{ kind: "place" }, "place"],
    [{ kind: "placeConfirm" }, "place_confirm"],
    [{ kind: "photos" }, "photos"],
    [{ kind: "neighbourhood" }, "neighbourhood"],
    [{ kind: "chronologyStep", step: 0 }, "guided_chronology"],
    [{ kind: "chronologyReview" }, "guided_chronology"],
    [{ kind: "summary" }, "summary"],
    [{ kind: "eventTime" }, "asking"],
    [{ kind: "cancelConfirm" }, "neighbourhood"],
  ])("%o is %s", (question, state) => {
    expect(stateFor(question, "neighbourhood")).toBe(state);
  });
});

describe("what a question settles", () => {
  test.each<[Question, string[]]>([
    [{ kind: "place" }, ["place"]],
    [{ kind: "placeConfirm" }, ["place"]],
    [{ kind: "photos" }, []],
    [{ kind: "neighbourhood" }, ["neighbourhood"]],
    [{ kind: "eventTime" }, ["eventTime"]],
    [{ kind: "choice", fieldId: "waterDepth" }, ["waterDepth"]],
    [{ kind: "multiChoice", fieldId: "urgentNeeds" }, ["urgentNeeds"]],
    [{ kind: "textQuestion", fieldId: "shelters", askedBefore: false }, ["shelters"]],
    [{ kind: "chronologyStep", step: 1 }, ["chronology"]],
    [{ kind: "chronologyReview" }, ["chronology"]],
    [
      { kind: "numberForm", groupId: "victims", fieldIds: ["dead", "missing"], askedBefore: false },
      ["dead", "missing"],
    ],
    [{ kind: "summary" }, []],
    [{ kind: "cancelConfirm" }, []],
  ])("%o", (question, fields) => {
    expect(questionFields(question)).toEqual(fields);
  });
});

describe("choice answers offered", () => {
  test("hazard types are the 10 selectable ones; subtypes follow the type and end with unknown", () => {
    expect(choiceOptions("hazardType", {}).map((option) => option.id)).toHaveLength(10);
    expect(choiceOptions("hazardType", {}).map((option) => option.id)).not.toContain("other");
    expect(choiceOptions("hazardSubtype", { hazardType: tapped("tsunami") }).map((option) => option.id)).toEqual([
      "seismic",
      "nonSeismic",
      "unknown",
    ]);
    expect(choiceOptions("hazardSubtype", {}).map((option) => option.id)).toEqual(["otherEvent", "unknown"]);
  });

  test("a list without a Tidak tahu gets one; a list with one keeps it once", () => {
    const depth = choiceOptions("waterDepth", { hazardType: tapped("flood") }).map((option) => option.id);
    expect(depth).toEqual(["ankle", "knee", "waist", "chest", "overHead", "unknown"]);
    const roads = choiceOptions("roadPassable", {}).map((option) => option.id);
    expect(roads.filter((id) => id === "unknown")).toHaveLength(1);
    const needs = choiceOptions("urgentNeeds", { hazardType: tapped("drought") }).map((option) => option.id);
    expect(needs.at(-1)).toBe("unknown");
    expect(needs).toContain("waterTanks");
    expect(needs).not.toContain("rubberBoats");
  });

  test("only a none or an unknown is exclusive", () => {
    expect(isExclusiveOption({ id: "none", meaning: "none" })).toBe(true);
    expect(isExclusiveOption({ id: "unknown", meaning: "unknown" })).toBe(true);
    expect(isExclusiveOption({ id: "elderly" })).toBe(false);
  });
});

describe("the GPS reading and the photo step", () => {
  const reading = { village: placed.place as never, nearby: [], showNearby: false };
  test("a waiting reading is confirmed before RT and RW; the photo step comes before the summary", () => {
    expect(nextQuestion("place", content({}, { placeReading: reading }), {})).toEqual({ kind: "placeConfirm" });
    expect(next(floodAllBut(), {}, { photosDone: null })).toEqual({ kind: "photos" });
    expect(next(floodAllBut(), {}, { photosDone: "continued" })).toEqual({ kind: "summary" });
  });
});

describe("an emergency", () => {
  const place = placed.place as FieldState;
  const emergency = (victims: "yes" | null) => ({ emergency: { victims } });

  test("asks for its place, what happened, whether anyone is hurt, then photos, and nothing else", () => {
    expect(next({}, {}, emergency(null))).toEqual({ kind: "place" });
    expect(next({ place }, {}, emergency(null))).toEqual({ kind: "choice", fieldId: "hazardType" });
    const told = { place, hazardType: tapped("flood") };
    expect(next(told, {}, emergency(null))).toEqual({ kind: "emergencyVictims" });
    expect(next(told, {}, { ...emergency("yes"), photosDone: null })).toEqual({ kind: "photos" });
    expect(next(told, {}, emergency("yes"))).toEqual({ kind: "summary" });
  });

  test("reopened from the summary asks what happened again, once", () => {
    const told = { place, hazardType: tapped("flood") };
    const edit = (done: ("hazardType" | "chronology")[]) => ({
      ...emergency("yes"),
      overlay: { kind: "edit" as const, groupId: "event" as const, done },
    });
    expect(next(told, {}, edit([]))).toEqual({ kind: "choice", fieldId: "hazardType" });
    expect(next(told, {}, edit(["chronology"]))).toEqual({ kind: "choice", fieldId: "hazardType" });
    expect(next(told, {}, edit(["hazardType"]))).toEqual({ kind: "summary" });
    expect(next(told, {}, { ...emergency("yes"), overlay: { kind: "cancelConfirm" } })).toEqual({
      kind: "cancelConfirm",
    });
  });

  test("its question about victims is asked in the asking state and settles no field", () => {
    expect(stateFor({ kind: "emergencyVictims" }, "place")).toBe("asking");
    expect(questionFields({ kind: "emergencyVictims" })).toEqual([]);
  });

  test("starts with nothing told and nothing said of victims", () => {
    expect(EMERGENCY_CONTENT).toEqual({ ...EMPTY_CONTENT, emergency: { victims: null } });
  });

  test("a draft that is not one is asked as before", () => {
    expect(next({ place }, {}, { emergency: null })).toEqual({ kind: "neighbourhood" });
  });
});

describe("news for a sent report", () => {
  const base: FieldStates = { ...event, dead: count(1), injured: none };
  const followUp = (states: FieldStates = base, extra: Partial<DraftContent> = {}): DraftContent => ({
    ...followUpContent({ ticketNumber: "LA-251126-01", base, photosLeft: 4 }),
    states,
    ...extra,
  });
  const asks = (content: DraftContent) => nextQuestion("summary", content, {});
  const edit = (groupId: "event" | "victims", done: ("chronology" | "dead")[] = []) =>
    ({ overlay: { kind: "edit", groupId, done } }) as const;

  test("starts on its review, with what the report holds and the photos it may add", () => {
    const content = followUpContent({ ticketNumber: "LA-251126-01", base, photosLeft: 4 });
    expect(content).toEqual({
      ...EMPTY_CONTENT,
      states: base,
      photosDone: "continued",
      followUp: { ticketNumber: "LA-251126-01", base, photosLeft: 4 },
    });
    expect(asks(content)).toEqual({ kind: "summary" });
    expect(photoMax(content)).toBe(4);
    expect(photoMax(EMPTY_CONTENT)).toBe(10);
  });

  test("asks nothing the report left open, only the group picked", () => {
    expect(asks(followUp(base, edit("victims")))).toEqual({
      kind: "numberForm",
      groupId: "victims",
      fieldIds: ["dead", "missing", "injured"],
      askedBefore: false,
    });
    expect(asks(followUp(base, edit("victims", ["dead"])))).toMatchObject({ fieldIds: ["missing", "injured"] });
  });

  test("what the report is about is not asked again: its event group asks the chronology alone", () => {
    expect(asks(followUp(base, edit("event")))).toEqual({ kind: "chronologyStep", step: 0 });
    expect(asks(followUp(base, edit("event", ["chronology"])))).toEqual({ kind: "summary" });
  });

  test("a report whose hazard was not known may be told it", () => {
    const tap: FieldStates = { ...placed, hazardType: empty, eventTime: event.eventTime };
    const content = {
      ...followUpContent({ ticketNumber: "LA-251126-01", base: tap, photosLeft: 4 }),
      ...edit("event"),
    };
    expect(asks(content)).toEqual({ kind: "choice", fieldId: "hazardType" });
  });

  test("a field the news opens is asked before the review", () => {
    expect(asks(followUp({ ...base, injured: count(3) }))).toEqual({
      kind: "numberForm",
      groupId: "victims",
      fieldIds: ["injuredInpatient"],
      askedBefore: false,
    });
    expect(asks(followUp({ ...base, injured: count(3), injuredInpatient: none }))).toEqual({ kind: "summary" });
  });

  test("photos reopened come before the review; a cancel is confirmed first", () => {
    expect(asks(followUp(base, { photosDone: null }))).toEqual({ kind: "photos" });
    expect(asks(followUp(base, { overlay: { kind: "cancelConfirm" } }))).toEqual({ kind: "cancelConfirm" });
  });
});
