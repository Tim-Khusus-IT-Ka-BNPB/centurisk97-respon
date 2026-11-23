import { describe, expect, test } from "vitest";
import { type ChronologyStep, chronologySteps, isExclusive } from "../chronology";
import {
  HAZARD_TYPE_IDS,
  isHazardTypeId,
  isSelectableHazardType,
  isSubtypeOf,
  SELECTABLE_HAZARD_TYPES,
  subtypeChoices,
} from "../hazards";
import { FIELDS, fieldById, GROUP_IDS, isFieldId } from "./catalogue";
import { applicableOptions, URGENT_NEEDS, VULNERABLE_GROUPS } from "./options";

const ID = /^[a-z][a-zA-Z0-9]*$/;

// The ids below are the contract the copy catalogue is keyed to. A change here must change the copy keys too.
describe("field spec ids", () => {
  test("fields, groups and options, in asking order", () => {
    expect(FIELDS).toMatchSnapshot();
  });

  test("hazard types and subtypes", () => {
    expect(HAZARD_TYPE_IDS.map((id) => [id, subtypeChoices(id)])).toMatchSnapshot();
  });

  test("guided chronology steps per hazard type", () => {
    expect(HAZARD_TYPE_IDS.map((id) => [id, chronologySteps(id)])).toMatchSnapshot();
  });

  test("every id is a camelCase English word and unique where it is used", () => {
    expect(FIELDS.every((field) => ID.test(field.id))).toBe(true);
    expect(new Set(FIELDS.map((field) => field.id)).size).toBe(FIELDS.length);
    for (const field of FIELDS) {
      if (!("options" in field)) continue;
      const ids = field.options.map((option) => option.id);
      expect(ids.every((id) => ID.test(id))).toBe(true);
      expect(new Set(ids).size).toBe(ids.length);
    }
    for (const hazard of HAZARD_TYPE_IDS) {
      expect(new Set(subtypeChoices(hazard)).size).toBe(subtypeChoices(hazard).length);
      for (const step of chronologySteps(hazard)) {
        const ids = step.options.map((option) => option.id);
        expect(ids.every((id) => ID.test(id))).toBe(true);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });

  test("a follow-up comes after the count it depends on", () => {
    FIELDS.forEach((field, index) => {
      if (!("parent" in field)) return;
      const parentIndex = FIELDS.findIndex((other) => other.id === field.parent);
      expect(parentIndex).toBeGreaterThanOrEqual(0);
      expect(parentIndex).toBeLessThan(index);
      expect(fieldById(field.parent).kind).toBe("count");
    });
  });

  test("fields are grouped in group order", () => {
    const order = FIELDS.map((field) => GROUP_IDS.indexOf(field.group));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  test("the five required fields", () => {
    expect(FIELDS.filter((field) => "required" in field).map((field) => field.id)).toEqual([
      "place",
      "hazardType",
      "hazardSubtype",
      "chronology",
      "eventTime",
    ]);
  });

  test("field lookup", () => {
    expect(isFieldId("dead")).toBe(true);
    expect(isFieldId("meninggal")).toBe(false);
    expect(isFieldId(3)).toBe(false);
    expect(fieldById("dead")).toEqual({ id: "dead", group: "victims", kind: "count", unit: "people", max: 100_000 });
  });
});

describe("hazard types", () => {
  test("ten are offered; the legacy type is kept for old reports only", () => {
    expect(SELECTABLE_HAZARD_TYPES).toHaveLength(10);
    expect(SELECTABLE_HAZARD_TYPES).not.toContain("other");
    expect(HAZARD_TYPE_IDS).toContain("other");
    expect(isHazardTypeId("other")).toBe(true);
    expect(isSelectableHazardType("other")).toBe(false);
    expect(isSelectableHazardType("flood")).toBe(true);
    expect(isSelectableHazardType("rahasia")).toBe(false);
    expect(isHazardTypeId("rahasia")).toBe(false);
    expect(isHazardTypeId("toString")).toBe(false);
    expect(isHazardTypeId(1)).toBe(false);
  });

  test("every subtype question offers not known last", () => {
    for (const hazard of HAZARD_TYPE_IDS) expect(subtypeChoices(hazard).at(-1)).toBe("unknown");
    expect(isSubtypeOf("flood", "flashFlood")).toBe(true);
    expect(isSubtypeOf("flood", "unknown")).toBe(true);
    expect(isSubtypeOf("flood", "tectonic")).toBe(false);
    expect(isSubtypeOf("flood", null)).toBe(false);
  });
});

describe("choice options", () => {
  test("hazard specific needs show only once the type is known", () => {
    const ids = (hazard: Parameters<typeof applicableOptions>[1]) =>
      applicableOptions(URGENT_NEEDS, hazard).map((option) => option.id);
    expect(ids(null)).toEqual(["foodParcels", "drinkingWater", "medicalCare", "other", "noUrgentNeed"]);
    expect(ids("drought")).toEqual([
      "foodParcels",
      "drinkingWater",
      "medicalCare",
      "waterTanks",
      "other",
      "noUrgentNeed",
    ]);
    expect(ids("forestFire")).toContain("readyMeals");
    expect(ids("forestFire")).toContain("masks");
    expect(ids("forestFire")).not.toContain("tents");
    expect(applicableOptions(VULNERABLE_GROUPS, "flood")).toEqual(VULNERABLE_GROUPS);
  });
});

describe("guided chronology", () => {
  test("every offered type has steps and the legacy type has none", () => {
    for (const hazard of SELECTABLE_HAZARD_TYPES) expect(chronologySteps(hazard).length).toBeGreaterThanOrEqual(7);
    expect(chronologySteps("other")).toEqual([]);
  });

  test("a multiple choice step has a prefix and one typed answer", () => {
    for (const hazard of SELECTABLE_HAZARD_TYPES) {
      for (const step of chronologySteps(hazard)) {
        const typed = step.options.filter((option) => option.freeText);
        expect(typed).toHaveLength(step.multiple ? 1 : 0);
        expect(step.prefix).toBe(step.multiple);
      }
    }
  });

  test("a step with a dangerous answer carries a warning", () => {
    for (const hazard of SELECTABLE_HAZARD_TYPES) {
      for (const step of chronologySteps(hazard)) {
        if (step.options.some((option) => option.danger)) expect(step.warning).toBe(true);
      }
    }
  });

  test("silent answers are exclusive on multiple choice steps only", () => {
    const exclusive = (step: ChronologyStep) =>
      step.options.filter((option) => isExclusive(step, option)).map((option) => option.id);
    const [, floodRise, floodWhatFlooded] = chronologySteps("flood") as [
      ChronologyStep,
      ChronologyStep,
      ChronologyStep,
    ];
    expect(exclusive(floodWhatFlooded)).toEqual(["unknown"]);
    expect(exclusive(floodRise)).toEqual([]);
  });
});
