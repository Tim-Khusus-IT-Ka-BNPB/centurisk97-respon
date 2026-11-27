import { describe, expect, test } from "vitest";
import { CASE_KINDS, CASE_SPEC, checkFileFields, checkRecord, faceAllowed, photosMissing } from "./caseSpec";

const SHELTER = "0123456789abcdef";
const HOUSE = {
  headOfFamily: "  Uji   Satu ",
  village: "Uji",
  district: "Baktiya",
  address: "Dusun Satu",
  damage: "heavy",
  flooded: true,
  occupancy: "displaced",
  people: "4",
};
const EVACUEE = {
  shelter: SHELTER,
  name: "Uji Dua",
  age: 30,
  sex: "female",
  homeVillage: "Uji",
  entered: "2026-11-24",
  head: "self",
  phone: "0800 0000 0001",
};

describe("a record checked against its kind", () => {
  test("keeps general and personal values apart, tidied, with what is unknown dropped", () => {
    expect(checkRecord("house", { ...HOUSE, owner: "", note: null, nickname: "x" })).toEqual({
      errors: [],
      data: {
        village: "Uji",
        district: "Baktiya",
        address: "Dusun Satu",
        damage: "heavy",
        flooded: true,
        occupancy: "displaced",
        people: 4,
      },
      personal: { headOfFamily: "Uji Satu" },
    });
    expect(checkRecord("evacuee", { ...EVACUEE, nik: "3201-0101-0101-0001", vulnerable: ["sick", "sick"] })).toEqual({
      errors: [],
      data: { shelter: SHELTER, age: 30, sex: "female", homeVillage: "Uji", entered: "2026-11-24", head: "self" },
      personal: { name: "Uji Dua", phone: "+6280000000001", nik: "3201010101010001", vulnerable: ["sick"] },
    });
  });

  test("names each value that does not fit, in the form's order, and each one missing", () => {
    expect(
      checkRecord("house", { ...HOUSE, damage: "total", flooded: "ya", people: "4.5", address: "x".repeat(201) }),
    ).toMatchObject({ errors: ["address", "damage", "flooded", "people"] });
    expect(checkRecord("house", { ...HOUSE, people: 101 }).errors).toEqual(["people"]);
    expect(checkRecord("house", { ...HOUSE, people: -1 }).errors).toEqual(["people"]);
    expect(checkRecord("house", { ...HOUSE, people: 0 }).errors).toEqual([]);
    expect(checkRecord("house", { ...HOUSE, people: 100, headOfFamily: "   " }).errors).toEqual(["headOfFamily"]);
    expect(checkRecord("house", { ...HOUSE, headOfFamily: 12 }).personal).toEqual({ headOfFamily: "12" });
    expect(checkRecord("house", { ...HOUSE, headOfFamily: true }).errors).toEqual(["headOfFamily"]);
    expect(checkRecord("house", { ...HOUSE, address: "x".repeat(200) }).errors).toEqual([]);
    expect(checkRecord("house", { village: "Uji" }).errors).toEqual([
      "headOfFamily",
      "district",
      "address",
      "damage",
      "flooded",
      "occupancy",
      "people",
    ]);
  });

  test("reads a number with a comma, a date only as a real day, a NIK as its 16 digits", () => {
    const business = { type: "rice", village: "Uji", amount: "2,5", unit: "hectare" };
    expect(checkRecord("business", business).data).toMatchObject({ amount: 2.5 });
    expect(checkRecord("business", { ...business, amount: "dua" }).errors).toEqual(["amount"]);
    expect(checkRecord("business", { ...business, amount: Number.POSITIVE_INFINITY }).errors).toEqual(["amount"]);
    expect(checkRecord("business", { ...business, amount: 10_000_000 }).errors).toEqual([]);
    expect(checkRecord("business", { ...business, amount: 10_000_001 }).errors).toEqual(["amount"]);
    expect(checkRecord("evacuee", { ...EVACUEE, entered: "2026-02-30" }).errors).toEqual(["entered"]);
    expect(checkRecord("evacuee", { ...EVACUEE, entered: "24-11-2026" }).errors).toEqual(["entered"]);
    expect(checkRecord("evacuee", { ...EVACUEE, entered: "x2026-11-24" }).errors).toEqual(["entered"]);
    expect(checkRecord("evacuee", { ...EVACUEE, entered: 20261124 }).errors).toEqual(["entered"]);
    expect(checkRecord("evacuee", { ...EVACUEE, entered: ["2026-11-24"] }).errors).toEqual(["entered"]);
    expect(checkRecord("evacuee", { ...EVACUEE, entered: "2026-13-45" }).errors).toEqual(["entered"]);
    expect(checkRecord("evacuee", { ...EVACUEE, entered: "2026-11-24x" }).errors).toEqual(["entered"]);
    expect(checkRecord("evacuee", { ...EVACUEE, nik: "123" }).errors).toEqual(["nik"]);
    expect(checkRecord("evacuee", { ...EVACUEE, nik: "32010101010100012" }).errors).toEqual(["nik"]);
    expect(checkRecord("evacuee", { ...EVACUEE, age: 120 }).errors).toEqual([]);
    expect(checkRecord("evacuee", { ...EVACUEE, age: 121 }).errors).toEqual(["age"]);
  });

  test("asks a head of family's phone, or none, and an evacuee's shelter and head as records", () => {
    expect(checkRecord("evacuee", { ...EVACUEE, phone: undefined }).errors).toEqual(["phone"]);
    expect(checkRecord("evacuee", { ...EVACUEE, phone: "none" }).personal).toMatchObject({ phone: "none" });
    expect(checkRecord("evacuee", { ...EVACUEE, phone: "12345" }).errors).toEqual(["phone"]);
    expect(checkRecord("evacuee", { ...EVACUEE, head: "fedcba9876543210", phone: undefined }).errors).toEqual([]);
    expect(checkRecord("evacuee", { ...EVACUEE, head: "x".repeat(17) }).errors).toEqual(["head"]);
    expect(checkRecord("evacuee", { ...EVACUEE, shelter: "TP-1" }).errors).toEqual(["shelter"]);
    expect(checkRecord("evacuee", { ...EVACUEE, shelter: 7 }).errors).toEqual(["shelter"]);
    expect(checkRecord("evacuee", { ...EVACUEE, shelter: [SHELTER] }).errors).toEqual(["shelter"]);
    expect(checkRecord("evacuee", { ...EVACUEE, shelter: `x${SHELTER}` }).errors).toEqual(["shelter"]);
    expect(checkRecord("evacuee", { ...EVACUEE, shelter: `${SHELTER}0` }).errors).toEqual(["shelter"]);
    expect(checkRecord("evacuee", { ...EVACUEE, vulnerable: ["sick", "tired"] }).errors).toEqual(["vulnerable"]);
    expect(checkRecord("evacuee", { ...EVACUEE, vulnerable: "sick" }).errors).toEqual(["vulnerable"]);
  });

  test("an evacuee leaves on or after the day they came", () => {
    expect(checkRecord("evacuee", { ...EVACUEE, left: "2026-11-24" }).errors).toEqual([]);
    expect(checkRecord("evacuee", { ...EVACUEE, left: "2026-11-23" }).errors).toEqual(["left"]);
    expect(checkRecord("evacuee", { ...EVACUEE, entered: undefined, left: "2026-11-23" }).errors).toEqual(["entered"]);
  });

  test("asks more of a missing victim, a road or bridge, and a need with no shelter", () => {
    const victim = {
      status: "dead",
      name: "Uji",
      age: 40,
      sex: "male",
      village: "Uji",
      contactName: "Uji",
      contactPhone: "none",
    };
    expect(checkRecord("victim", victim).errors).toEqual([]);
    expect(checkRecord("victim", { ...victim, status: "missing" }).errors).toEqual([
      "lastSeenPlace",
      "lastSeenOn",
      "search",
    ]);
    const bridge = { type: "bridge", name: "Uji", village: "Uji", damage: "heavy", function: "cut" };
    expect(checkRecord("infrastructure", bridge).errors).toEqual(["lengthM", "vehicles"]);
    expect(checkRecord("infrastructure", { ...bridge, type: "road" }).errors).toEqual(["lengthM", "vehicles"]);
    expect(checkRecord("infrastructure", { ...bridge, type: "school" }).errors).toEqual([]);
    const need = { item: "water", amount: 10, unit: "galon", urgent: false };
    expect(checkRecord("need", need).errors).toEqual(["village"]);
    expect(checkRecord("need", { ...need, shelter: SHELTER }).errors).toEqual([]);
  });

  test("every kind's form as agreed", () => {
    const form = Object.fromEntries(
      CASE_KINDS.map((kind) => [
        kind,
        CASE_SPEC[kind].fields.map((one) => ({
          ...one,
          required: typeof one.required === "function" ? "depends" : one.required,
        })),
      ]),
    );
    expect(form).toMatchSnapshot();
  });

  test("every kind has its form", () => {
    expect(CASE_KINDS.map((kind) => [kind, CASE_SPEC[kind].photos])).toEqual([
      ["house", 2],
      ["infrastructure", 2],
      ["shelter", 1],
      ["evacuee", 0],
      ["victim", 0],
      ["business", 1],
      ["need", 0],
    ]);
    expect(CASE_SPEC.shelter.fields.filter((one) => one.required === true).map((one) => one.id)).toEqual([
      "name",
      "village",
      "placeKind",
      "placeType",
      "openedOn",
      "needWater",
      "needFood",
      "needClothing",
      "needHealth",
      "needHousing",
      "needEducation",
    ]);
  });
});

describe("photos", () => {
  test("a face only of an adult evacuee who has not refused, or a victim still searched for", () => {
    expect(faceAllowed("evacuee", { age: 18 })).toBe(true);
    expect(faceAllowed("evacuee", { age: 17 })).toBe(false);
    expect(faceAllowed("evacuee", { age: 30, refusesPhoto: true })).toBe(false);
    expect(faceAllowed("evacuee", { age: 30, refusesPhoto: false })).toBe(true);
    expect(faceAllowed("victim", { status: "missing", search: "searching" })).toBe(true);
    expect(faceAllowed("victim", { status: "missing", search: "foundAlive" })).toBe(false);
    expect(faceAllowed("victim", { status: "dead", search: "searching" })).toBe(false);
    expect(faceAllowed("house", { age: 30 })).toBe(false);
    expect(faceAllowed("house", { status: "missing", search: "searching" })).toBe(false);
  });

  test("each kind's number still to take, and an adult evacuee's face", () => {
    expect(photosMissing("house", {}, [{ kind: "photo" }, { kind: "video" }])).toEqual({ photo: 1, face: 0 });
    expect(photosMissing("house", {}, [{ kind: "photo" }, { kind: "photo" }, { kind: "photo" }])).toEqual({
      photo: 0,
      face: 0,
    });
    expect(photosMissing("evacuee", { age: 30 }, [])).toEqual({ photo: 0, face: 1 });
    expect(photosMissing("evacuee", { age: 30 }, [{ kind: "face" }])).toEqual({ photo: 0, face: 0 });
    expect(photosMissing("evacuee", { age: 10 }, [])).toEqual({ photo: 0, face: 0 });
    expect(photosMissing("victim", { status: "missing", search: "searching" }, [])).toEqual({ photo: 0, face: 0 });
  });
});

describe("the file's own values", () => {
  const today = "2026-11-27";
  test("as a patch: each value read, null clearing one", () => {
    expect(
      checkFileFields(
        {
          emergencyStatus: "emergencyResponse",
          decreeNumber: "  360/12/2026 ",
          decreeDate: "2026-11-27",
          efforts: "Evakuasi",
          personnel: 40,
          post: { name: "Posko Uji", shelter: SHELTER, phone: "(0645) 123-456" },
        },
        today,
        false,
      ),
    ).toEqual({
      errors: [],
      patch: {
        emergencyStatus: "emergencyResponse",
        decreeNumber: "360/12/2026",
        decreeDate: "2026-11-27",
        efforts: "Evakuasi",
        personnel: 40,
        post: { name: "Posko Uji", shelter: SHELTER, phone: "0645123456" },
      },
    });
    expect(checkFileFields({ efforts: null, decreeNumber: "", post: null }, today, true)).toEqual({
      errors: [],
      patch: { efforts: null, decreeNumber: null, post: null },
    });
  });

  test("refuses what does not fit, a decree dated after today, and a post with no name", () => {
    expect(checkFileFields(null, today, false)).toEqual({ errors: ["fields"], patch: {} });
    expect(checkFileFields([], today, false).errors).toEqual(["fields"]);
    expect(checkFileFields("x", today, false).errors).toEqual(["fields"]);
    expect(
      checkFileFields(
        {
          emergencyStatus: "panic",
          decreeNumber: "x".repeat(61),
          decreeDate: "2026-11-28",
          efforts: 5,
          personnel: 1.5,
          colour: "red",
        },
        today,
        false,
      ).errors,
    ).toEqual(["emergencyStatus", "decreeNumber", "decreeDate", "efforts", "personnel", "colour"]);
    expect(checkFileFields({ personnel: -1 }, today, false).errors).toEqual(["personnel"]);
    expect(checkFileFields({ personnel: 0, decreeNumber: "360  12" }, today, false)).toEqual({
      errors: [],
      patch: { personnel: 0, decreeNumber: "360 12" },
    });
    expect(checkFileFields({ colour: { name: "Posko" } }, today, false)).toEqual({ errors: ["colour"], patch: {} });
    expect(checkFileFields({ personnel: 100_001 }, today, false).errors).toEqual(["personnel"]);
    expect(checkFileFields({ personnel: 100_000, decreeNumber: "x".repeat(60) }, today, false).errors).toEqual([]);
    expect(checkFileFields({ decreeDate: "2026-02-30" }, today, false).errors).toEqual(["decreeDate"]);
    expect(checkFileFields({ efforts: "   " }, today, false).errors).toEqual(["efforts"]);
    expect(checkFileFields({ efforts: "x".repeat(501) }, today, false).errors).toEqual(["efforts"]);
    const post = (value: unknown, named = false) => checkFileFields({ post: value }, today, named);
    expect(post({ phone: "0645123456" }).errors).toEqual(["post"]);
    expect(post({ phone: "0645123456" }, true)).toEqual({ errors: [], patch: { post: { phone: "0645123456" } } });
    expect(post({ name: null, phone: "0645123456" }, true).errors).toEqual(["post"]);
    expect(post({ name: "Posko", shelter: null })).toEqual({
      errors: [],
      patch: { post: { name: "Posko", shelter: null } },
    });
    expect(post({}).errors).toEqual(["post"]);
    expect(post([]).errors).toEqual(["post"]);
    expect(post("Posko").errors).toEqual(["post"]);
    expect(post({ name: "Posko", phone: "12345" }).errors).toEqual(["post"]);
    expect(post({ name: "Posko", phone: "+1234567890123456" }).errors).toEqual(["post"]);
    expect(post({ name: "Posko", phone: "+123456789012345" }).errors).toEqual([]);
    expect(post({ name: "Posko", shelter: "x" }).errors).toEqual(["post"]);
    expect(post({ name: "x".repeat(121) }).errors).toEqual(["post"]);
    expect(post({ name: "Posko", city: "Uji" }).errors).toEqual(["post"]);
    expect(post({ name: "Posko", city: "0645123456" }).errors).toEqual(["post"]);
    expect(post({ name: "Posko", phone: "" })).toEqual({ errors: [], patch: { post: { name: "Posko", phone: null } } });
    expect(post({ shelter: null, phone: "0645123456" }).errors).toEqual(["post"]);
    expect(post({ shelter: null })).toEqual({ errors: [], patch: { post: { shelter: null } } });
    expect(post(["Posko"]).errors).toEqual(["post"]);
    expect(post(5).errors).toEqual(["post"]);
  });
});
