import { describe, expect, test } from "vitest";
import type { Choice } from "./reply";
import { cardStepAt, type IdentityStep, identityMove, isIdentityStep } from "./step";

const NOW = Date.parse("2026-11-25T03:00:00.000Z");
const CONSENT: readonly Choice[] = [
  { id: "agree", label: "Setuju", means: "yes" },
  { id: "decline", label: "Tidak setuju", means: "no" },
];
const ROLES: readonly Choice[] = [
  { id: "citizen", label: "Warga" },
  { id: "claimedOfficer", label: "Petugas BPBD" },
];
const agreed = { agreedAtMs: NOW - 60_000, emergency: true };
const move = (step: IdentityStep, text: string, choices: readonly Choice[] = []) =>
  identityMove(step, text, choices, NOW);

describe("who is reporting", () => {
  test("consent leads to the role, with the time it was given", () => {
    expect(move({ kind: "consent", emergency: true }, "1", CONSENT)).toEqual({
      kind: "ask",
      step: { kind: "role", agreedAtMs: NOW, emergency: true },
    });
    expect(move({ kind: "consent", emergency: false }, "ya", CONSENT)).toEqual({
      kind: "ask",
      step: { kind: "role", agreedAtMs: NOW, emergency: false },
    });
    expect(move({ kind: "consent", emergency: false }, "tidak", CONSENT)).toEqual({ kind: "declined" });
    for (const text of ["3", "banjir", "1 2"])
      expect(move({ kind: "consent", emergency: false }, text, CONSENT), text).toEqual({ kind: "unclear" });
  });

  test("a citizen is known by a name", () => {
    expect(move({ kind: "role", ...agreed }, "warga", ROLES)).toEqual({
      kind: "ask",
      step: { kind: "name", role: "citizen", ...agreed },
    });
    expect(move({ kind: "role", ...agreed }, "polisi", ROLES)).toEqual({ kind: "unclear" });
    expect(move({ kind: "name", role: "citizen", ...agreed }, "  Uji   Satu ")).toEqual({
      kind: "known",
      identity: { role: "citizen", name: "Uji Satu", officerRegency: "", officerPosition: "" },
      ...agreed,
    });
  });

  test("an officer also by BPBD and post", () => {
    expect(move({ kind: "role", ...agreed }, "2", ROLES)).toEqual({
      kind: "ask",
      step: { kind: "name", role: "claimedOfficer", ...agreed },
    });
    expect(move({ kind: "name", role: "claimedOfficer", ...agreed }, "Uji Dua")).toEqual({
      kind: "ask",
      step: { kind: "officerRegency", name: "Uji Dua", ...agreed },
    });
    expect(move({ kind: "officerRegency", name: "Uji Dua", ...agreed }, " Kabupaten  Uji")).toEqual({
      kind: "ask",
      step: { kind: "officerPosition", name: "Uji Dua", officerRegency: "Kabupaten Uji", ...agreed },
    });
    expect(
      move({ kind: "officerPosition", name: "Uji Dua", officerRegency: "Kabupaten Uji", ...agreed }, "Staf "),
    ).toEqual({
      kind: "known",
      identity: {
        role: "claimedOfficer",
        name: "Uji Dua",
        officerRegency: "Kabupaten Uji",
        officerPosition: "Staf",
      },
      ...agreed,
    });
  });

  test("each is held against the rule of its own box", () => {
    expect(move({ kind: "name", role: "citizen", ...agreed }, "Uji 1")).toEqual({
      kind: "invalid",
      rule: "name.digits",
      params: { label: "identity.name.label" },
    });
    expect(move({ kind: "name", role: "claimedOfficer", ...agreed }, "U")).toMatchObject({ rule: "name.tooShort" });
    expect(move({ kind: "officerRegency", name: "Uji Dua", ...agreed }, "ab")).toMatchObject({
      kind: "invalid",
      rule: "officerRegency.tooShort",
    });
    expect(
      move({ kind: "officerPosition", name: "Uji Dua", officerRegency: "Kabupaten Uji", ...agreed }, "x"),
    ).toMatchObject({ kind: "invalid", rule: "officerPosition.tooShort" });
    expect(move({ kind: "officerRegency", name: "Uji Dua", ...agreed }, "a".repeat(81))).toMatchObject({
      rule: "text.tooLong",
    });
  });
});

describe("where a chat stands", () => {
  test("the steps that ask who is reporting", () => {
    expect(isIdentityStep({ kind: "consent", emergency: false })).toBe(true);
    expect(isIdentityStep({ kind: "role", ...agreed })).toBe(true);
    expect(isIdentityStep({ kind: "name", role: "citizen", ...agreed })).toBe(true);
    expect(isIdentityStep({ kind: "officerRegency", name: "Uji", ...agreed })).toBe(true);
    expect(isIdentityStep({ kind: "officerPosition", name: "Uji", officerRegency: "Uji", ...agreed })).toBe(true);
    expect(isIdentityStep({ kind: "groups", revision: 3 })).toBe(false);
  });

  test("half an answer belongs to one revision of the draft", () => {
    const hour = { kind: "hour", revision: 3, day: "today" } as const;
    expect(cardStepAt(hour, 3)).toBe(hour);
    expect(cardStepAt(hour, 4)).toBeNull();
    expect(cardStepAt({ kind: "consent", emergency: false }, 3)).toBeNull();
    expect(cardStepAt(null, 3)).toBeNull();
  });
});
