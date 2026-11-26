import { describe, expect, test } from "vitest";
import type { FieldStates } from "../fieldState";
import { applicableFields, chosenHazardType, completePercent, fieldsForHazard, keepableFields } from "./applicable";
import { FIELDS } from "./catalogue";

const ids = (fields: readonly { id: string }[]) => fields.map((field) => field.id);
const tapped = (value: string) => ({ state: "value", value, origin: "tappedOption" }) as const;
const count = (value: number) => ({ state: "value", value, origin: "boxEntry" }) as const;
const none = { state: "none", origin: "boxEntry" } as const;

describe("fields that apply", () => {
  test("before a hazard type only fields open to every type apply", () => {
    const fields = ids(fieldsForHazard(null));
    expect(fields).toContain("housesHeavy");
    expect(fields).toContain("roads");
    expect(fields).not.toContain("housesFlooded");
    expect(fields).not.toContain("waterDepth");
  });

  test("drought drops house, facility and road damage", () => {
    const fields = ids(fieldsForHazard("drought"));
    for (const id of [
      "housesHeavy",
      "housesModerate",
      "housesLight",
      "schools",
      "healthFacilities",
      "worshipPlaces",
      "roads",
    ]) {
      expect(fields).not.toContain(id);
    }
    expect(fields).toContain("cleanWater");
    expect(fields).toContain("farmland");
  });

  test("flood adds flooded houses, water depth and farmland", () => {
    const fields = ids(fieldsForHazard("flood"));
    expect(fields).toEqual(expect.arrayContaining(["housesFlooded", "waterDepth", "farmland", "roads"]));
    expect(fields).not.toContain("burntArea");
  });

  test("fires have no road question; building fire also no farmland", () => {
    expect(ids(fieldsForHazard("forestFire"))).not.toContain("roads");
    expect(ids(fieldsForHazard("forestFire"))).toContain("burntArea");
    expect(ids(fieldsForHazard("buildingFire"))).not.toContain("farmland");
    expect(ids(fieldsForHazard("buildingFire"))).toContain("housesHeavy");
  });

  test("the chosen hazard type comes from a stored value only", () => {
    expect(chosenHazardType({ hazardType: tapped("flood") })).toBe("flood");
    expect(chosenHazardType({ hazardType: tapped("rahasia") })).toBeNull();
    expect(chosenHazardType({ hazardType: { state: "notYetKnown" } })).toBeNull();
    expect(chosenHazardType({})).toBeNull();
  });

  test("a follow-up applies only when its parent count is above 0", () => {
    const followUps = (states: FieldStates) =>
      ids(applicableFields(states)).filter((id) =>
        ["injuredInpatient", "shelters", "roadNames", "roadPassable"].includes(id),
      );
    expect(followUps({})).toEqual([]);
    expect(followUps({ injured: none, roads: { state: "confirmedUnknown", origin: "boxEntry" } })).toEqual([]);
    expect(followUps({ injured: count(1), displacedPeople: count(4), roads: count(2) })).toEqual([
      "injuredInpatient",
      "shelters",
      "roadNames",
      "roadPassable",
    ]);
    expect(followUps({ injured: { state: "notYetKnown" } })).toEqual([]);
  });
});

describe("completeness", () => {
  const flood = { hazardType: tapped("flood") } as const;

  test("value, none and confirmed unknown count; not yet known and not asked do not", () => {
    const applicable = applicableFields(flood).length;
    expect(completePercent(flood)).toBe(Math.round(100 / applicable));
    expect(
      completePercent({
        ...flood,
        dead: none,
        missing: { state: "confirmedUnknown", origin: "boxEntry" },
        injured: { state: "notYetKnown" },
      }),
    ).toBe(Math.round(300 / applicable));
  });

  test("an empty draft is 0 percent and rounding is to the nearest whole", () => {
    expect(completePercent({})).toBe(0);
    const applicable = applicableFields({}).length;
    expect(applicable).toBe(27);
    expect(completePercent({ dead: none })).toBe(4);
    expect(completePercent({ dead: none, missing: none })).toBe(7);
  });

  test("medical help is asked after injuries, for some hazards without them, and stays once answered", () => {
    const has = (states: Record<string, unknown>) =>
      applicableFields(states as never).some((field) => field.id === "medicalHelp");
    const landslide = { hazardType: { state: "value", value: "landslide", origin: "tappedOption" } };
    expect(has(landslide)).toBe(false);
    expect(has({ ...landslide, injured: count(1) })).toBe(true);
    expect(has(flood)).toBe(true);
    expect(has({ ...landslide, medicalHelp: { state: "confirmedUnknown", origin: "tappedOption" } })).toBe(true);
  });

  test("a parent above 0 adds its follow-up to the count", () => {
    const withInjured = { ...flood, injured: count(2) };
    expect(applicableFields(withInjured).length).toBe(applicableFields(flood).length + 1);
  });

  test("before a type is chosen a value told in words may be kept for any field", () => {
    expect(keepableFields({})).toBe(FIELDS);
    expect(keepableFields({ hazardType: tapped("flood") })).toEqual(fieldsForHazard("flood"));
  });
});
