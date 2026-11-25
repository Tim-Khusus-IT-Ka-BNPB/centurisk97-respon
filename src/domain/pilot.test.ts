import { describe, expect, test } from "vitest";
import { checkPilotNumber, PILOT_MAX } from "./pilot";

describe("a number of the pilot", () => {
  test("is kept in its stored form, as anyone's or as a BPBD's", () => {
    expect(checkPilotNumber("0800 0000 0101", "")).toEqual({ number: "+6280000000101", officerRegency: null });
    expect(checkPilotNumber("6280000000101", "  Kabupaten   Uji ")).toEqual({
      number: "+6280000000101",
      officerRegency: "Kabupaten Uji",
    });
    expect(checkPilotNumber("0800 0000 0101", "Uji")).toMatchObject({ officerRegency: "Uji" });
    expect(checkPilotNumber("0800 0000 0101", "x".repeat(80))).toMatchObject({ officerRegency: "x".repeat(80) });
    expect(PILOT_MAX).toBe(500);
  });

  test("what cannot be read is named on its field", () => {
    expect(checkPilotNumber("123", "ab")).toEqual({
      errors: [
        { fieldId: "number", rule: "number.format", params: { label: "desk.pilot.number" } },
        { fieldId: "officerRegency", rule: "officerRegency.tooShort", params: { label: "desk.pilot.regency" } },
      ],
    });
    expect(checkPilotNumber("0800 0000 0101", "x".repeat(81))).toEqual({
      errors: [
        {
          fieldId: "officerRegency",
          rule: "text.tooLong",
          params: { label: "desk.pilot.regency", length: 81, max: 80 },
        },
      ],
    });
  });
});
