import { describe, expect, test } from "vitest";
import { checkIdentity, type IdentityInput } from "./identityForm";

const citizen: IdentityInput = {
  role: "citizen",
  name: "Uji Satu",
  number: "0800 0000 0001",
  officerRegency: "",
  officerPosition: "",
};
const errors = (input: Partial<IdentityInput>) => {
  const result = checkIdentity({ ...citizen, ...input });
  return "errors" in result ? result.errors : [];
};

describe("the identity and consent form", () => {
  test("a citizen with a tidy name and a number in any written form", () => {
    expect(
      checkIdentity({ ...citizen, name: "  Uji   Satu ", officerRegency: "Kabupaten Contoh", officerPosition: "Staf" }),
    ).toEqual({
      identity: {
        role: "citizen",
        name: "Uji Satu",
        number: "+6280000000001",
        officerRegency: null,
        officerPosition: null,
      },
    });
  });

  test("an officer needs regency and position, and keeps them tidy", () => {
    expect(
      checkIdentity({
        ...citizen,
        role: "claimedOfficer",
        officerRegency: " Kabupaten  Contoh ",
        officerPosition: "Staf",
      }),
    ).toEqual({
      identity: {
        role: "claimedOfficer",
        name: "Uji Satu",
        number: "+6280000000001",
        officerRegency: "Kabupaten Contoh",
        officerPosition: "Staf",
      },
    });
    expect(errors({ role: "claimedOfficer" })).toEqual([
      { fieldId: "officerRegency", rule: "required", params: { label: "identity.officerRegency.label" } },
      { fieldId: "officerPosition", rule: "required", params: { label: "identity.officerPosition.label" } },
    ]);
    expect(errors({ role: "claimedOfficer", officerRegency: "Ab", officerPosition: "S" })).toEqual([
      {
        fieldId: "officerRegency",
        rule: "officerRegency.tooShort",
        params: { label: "identity.officerRegency.label" },
      },
      {
        fieldId: "officerPosition",
        rule: "officerPosition.tooShort",
        params: { label: "identity.officerPosition.label" },
      },
    ]);
    expect(errors({ role: "claimedOfficer", officerRegency: "Abc", officerPosition: "St" })).toEqual([]);
    expect(errors({ role: "claimedOfficer", officerRegency: "a".repeat(81), officerPosition: "a".repeat(80) })).toEqual(
      [
        {
          fieldId: "officerRegency",
          rule: "text.tooLong",
          params: { label: "identity.officerRegency.label", length: 81, max: 80 },
        },
      ],
    );
  });

  test("the name: 2 to 80 letters with no digit, never cut", () => {
    const label = "identity.name.label";
    expect(errors({ name: "   " })).toEqual([{ fieldId: "name", rule: "required", params: { label } }]);
    expect(errors({ name: "Uji 123" })).toEqual([{ fieldId: "name", rule: "name.digits", params: { label } }]);
    expect(errors({ name: "U" })).toEqual([{ fieldId: "name", rule: "name.tooShort", params: { label } }]);
    expect(errors({ name: "Ui" })).toEqual([]);
    expect(errors({ name: "a".repeat(80) })).toEqual([]);
    expect(errors({ name: "a".repeat(81) })).toEqual([
      { fieldId: "name", rule: "name.tooLong", params: { label, length: 81 } },
    ]);
  });

  test("an unknown role and an unreadable number are named; the session path has no number", () => {
    expect(errors({ role: "boss", number: "12345" })).toEqual([
      { fieldId: "role", rule: "required", params: { label: "identity.role.label" } },
      { fieldId: "number", rule: "number.format", params: { label: "identity.number.label" } },
    ]);
    expect(errors({ role: "toString" })[0]?.fieldId).toBe("role");
    expect(checkIdentity({ ...citizen, number: null })).toMatchObject({ identity: { number: null } });
  });
});
