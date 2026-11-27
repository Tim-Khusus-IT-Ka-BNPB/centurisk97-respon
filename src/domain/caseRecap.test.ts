import { describe, expect, test } from "vitest";
import {
  type CaseMedia,
  type CaseRecord,
  canonical,
  dropFilledNil,
  FLAG_LIMITS,
  finalState,
  flagsOf,
  metricsWithRecords,
  NIL_METRICS,
  recapOf,
  recordPoint,
  sealedBody,
} from "./caseRecap";
import type { CaseKind, CaseValues } from "./caseSpec";
import { HOUR_MS } from "./time";

let next = 0;
const record = (kind: CaseKind, data: CaseValues, more: Partial<CaseRecord> = {}): CaseRecord => {
  next += 1;
  return {
    id: next.toString(16).padStart(16, "0"),
    kind,
    seq: next,
    data,
    personal: {},
    point: null,
    cancelled: false,
    ...more,
  };
};
const AT = { lat: 5.1, lon: 97.2 };
// About 111 m of latitude per 0.001 degree.
const north = (metres: number) => ({ lat: AT.lat + metres / 111_195, lon: AT.lon });
const photo = (more: Partial<CaseMedia> = {}): CaseMedia => ({ point: null, badge: "none", takenAtMs: null, ...more });

describe("a record's point", () => {
  test("typed, else its first photo's GPS point, else its first EXIF point, else none", () => {
    const gps = photo({ point: north(5), badge: "gps" });
    const exif = photo({ point: north(9), badge: "exif" });
    expect(recordPoint(AT, [gps])).toEqual(AT);
    expect(recordPoint(null, [exif, photo({ badge: "gps" }), gps])).toEqual(north(5));
    expect(recordPoint(null, [photo({ point: north(1), badge: "none" }), exif])).toEqual(north(9));
    expect(recordPoint(null, [photo({ badge: "exif" })])).toBeNull();
  });
});

describe("flags", () => {
  const inside = () => true;
  const flags = (one: CaseRecord, others: CaseRecord[] = [], media: CaseMedia[] = [], eventMs: number | null = null) =>
    flagsOf(one, { others, media, eventMs, inRegency: inside });

  test("a house or road with no point; never a person or a need", () => {
    expect(flags(record("house", {}))).toEqual(["noPoint"]);
    expect(flags(record("infrastructure", {}))).toEqual(["noPoint"]);
    for (const kind of ["evacuee", "victim", "need"] as const) expect(flags(record(kind, {}))).toEqual([]);
  });

  test("a photo far from the point, and one taken long before the event", () => {
    const house = record("house", {}, { point: AT });
    const far = FLAG_LIMITS.farPhotoM;
    expect(flags(house, [], [photo({ point: north(far - 5) })])).toEqual([]);
    expect(flags(house, [], [photo({ point: north(far + 5) })])).toEqual(["farPhoto"]);
    expect(flags(record("house", {}), [], [photo({ point: north(far + 5) })])).toEqual(["noPoint"]);
    const event = Date.UTC(2026, 10, 24);
    const limit = event - FLAG_LIMITS.oldPhotoHours * HOUR_MS;
    expect(flags(house, [], [photo({ takenAtMs: limit })], event)).toEqual([]);
    expect(flags(house, [], [photo({ takenAtMs: limit - 1 })], event)).toEqual(["oldPhoto"]);
    expect(flags(house, [], [photo({ takenAtMs: limit - 1 })], null)).toEqual([]);
    expect(flags(house, [], [photo()], event)).toEqual([]);
    expect(flags(house, [], [photo({ takenAtMs: event }), photo({ takenAtMs: limit - 1 })], event)).toEqual([
      "oldPhoto",
    ]);
  });

  test("two houses or roads at one point, only of one kind and not cancelled", () => {
    const house = record("house", {}, { point: AT });
    const near = FLAG_LIMITS.samePointM;
    expect(flags(house, [record("house", {}, { point: north(near - 1) })])).toEqual(["samePoint"]);
    expect(flags(house, [record("house", {}, { point: north(near + 2) })])).toEqual([]);
    expect(flags(house, [house])).toEqual([]);
    expect(flags(house, [record("infrastructure", {}, { point: AT })])).toEqual([]);
    expect(flags(house, [record("house", {}, { point: AT, cancelled: true })])).toEqual([]);
    expect(flags(house, [record("house", {})])).toEqual([]);
    expect(flags(record("house", {}), [record("house", {}, { point: AT })])).toEqual(["noPoint"]);
    const road = record("infrastructure", {}, { point: AT });
    expect(flags(road, [record("infrastructure", {}, { point: AT })])).toEqual(["samePoint"]);
    expect(flags(record("shelter", {}, { point: AT }), [record("shelter", {}, { point: AT })])).toEqual([]);
  });

  test("one NIK twice among evacuees or among victims, never across them (D16)", () => {
    const nik = { nik: "3201010101010001" };
    const evacuee = record("evacuee", {}, { personal: nik });
    expect(flags(evacuee, [record("evacuee", {}, { personal: nik })])).toEqual(["sameNik"]);
    expect(flags(evacuee, [record("victim", {}, { personal: nik })])).toEqual([]);
    expect(flags(evacuee, [record("evacuee", {}, { personal: { nik: "3201010101010002" } })])).toEqual([]);
    const victim = record("victim", {}, { personal: nik });
    expect(flags(victim, [record("victim", {}, { personal: nik })])).toEqual(["sameNik"]);

    expect(flags(record("evacuee", {}), [record("evacuee", {})])).toEqual([]);
  });

  test("a point outside the file's regency", () => {
    const house = record("house", {}, { point: AT });
    expect(flagsOf(house, { others: [], media: [], eventMs: null, inRegency: () => false })).toEqual([
      "outsideRegency",
    ]);
    expect(flagsOf(record("house", {}), { others: [], media: [], eventMs: null, inRegency: () => false })).toEqual([
      "noPoint",
    ]);
  });
});

const VICTIM = { age: 30, sex: "male" };
describe("totals", () => {
  test("count each metric from its records, cancelled ones left out", () => {
    const records = [
      record("house", { damage: "heavy", flooded: true }),
      record("house", { damage: "moderate", flooded: false }),
      record("house", { damage: "light", flooded: false }),
      record("house", { damage: "none", flooded: true }),
      record("house", { damage: "heavy", flooded: true }, { cancelled: true }),
      record("victim", { ...VICTIM, status: "dead" }),
      record("victim", { ...VICTIM, status: "missing", search: "foundDead", age: 70, sex: "female" }),
      record("victim", { ...VICTIM, status: "missing", search: "searching", age: 10 }),
      record("victim", { ...VICTIM, status: "missing", search: "foundAlive" }),
      record("victim", { ...VICTIM, status: "badlyHurt" }),
      record("victim", { ...VICTIM, status: "lightlyHurt", sex: "female", search: "searching" }),
      record("infrastructure", { type: "bridge", damage: "heavy", function: "cut" }),
      record("infrastructure", { type: "road", damage: "light", function: "limited", lengthM: 1250.4 }),
      record("infrastructure", { type: "road", damage: "light", function: "working" }),
      record("infrastructure", { type: "power", damage: "moderate", function: "cut" }),
      record("infrastructure", { type: "school", damage: "light", function: "working" }),
      record("infrastructure", { type: "other", damage: "light", function: "working" }),
    ];
    expect(recapOf(records, new Set(), null)).toEqual({
      dead: 2,
      missing: 1,
      injured: 2,
      displaced: null,
      housesHeavy: 1,
      housesModerate: 1,
      housesLight: 1,
      housesFlooded: 2,
      infrastructureCut: 2,
      bridgeHeavy: 1,
      roadKm: 1.25,
      powerUnits: 1,
      schoolLight: 1,
      deadAdultMale: 1,
      deadElderlyFemale: 1,
      missingChildMale: 1,
      injuredAdultMale: 1,
      injuredAdultFemale: 1,
    });
  });

  test("who is displaced on a day: in by then, not yet out", () => {
    const evacuee = (entered: string, left?: string) =>
      record("evacuee", { entered, ...(left ? { left } : {}), age: 17, sex: "female" });
    const records = [
      record("victim", { ...VICTIM, status: "dead", entered: "2026-11-20" }),
      evacuee("2026-11-24"),
      evacuee("2026-11-25", "2026-11-26"),
      evacuee("2026-11-26"),
      evacuee("2026-11-20", "2026-11-25"),
    ];
    expect(recapOf(records, new Set(), "2026-11-25")).toMatchObject({ displaced: 2, displacedChildFemale: 2 });
    expect(recapOf(records, new Set(), "2026-11-26")).toMatchObject({ displaced: 2 });
    expect(recapOf(records, new Set(), "2026-11-23")).toMatchObject({ displaced: 1 });
    expect(recapOf([evacuee("2026-11-20", "2026-11-21")], new Set(), "2026-11-25")).toMatchObject({ displaced: 0 });
    expect(recapOf(records, new Set(["displaced"]), null)).toMatchObject({ displaced: null });
  });

  test("none only when marked nil or ended in the list; never from nothing", () => {
    expect(recapOf([], new Set(), null)).toEqual({
      dead: null,
      missing: null,
      injured: null,
      displaced: null,
      housesHeavy: null,
      housesModerate: null,
      housesLight: null,
      housesFlooded: null,
      infrastructureCut: null,
    });
    const nil = new Set(["dead", "displaced", "bridgeLight", "colour"]);
    expect(recapOf([], nil, "2026-11-25")).toMatchObject({ dead: 0, displaced: 0, bridgeLight: 0 });
    expect(recapOf([], nil, "2026-11-25")).not.toHaveProperty("colour");
    expect(recapOf([], nil, null)).toMatchObject({ dead: 0, displaced: null, bridgeLight: 0 });
    expect(recapOf([record("house", { damage: "none" })], new Set(), "2026-11-25")).toMatchObject({ displaced: null });
    const ended = [
      record("victim", { ...VICTIM, status: "missing", search: "foundAlive" }),
      record("infrastructure", { type: "school", damage: "light", function: "working" }),
    ];
    expect(recapOf(ended, new Set(), null)).toMatchObject({ missing: 0, infrastructureCut: 0 });
    expect(recapOf([record("victim", { ...VICTIM, status: "dead" })], new Set(), null)).toMatchObject({
      missing: null,
    });
    expect(recapOf([record("house", { damage: "none" })], new Set(), null)).toMatchObject({ infrastructureCut: null });
    expect(
      recapOf(
        [record("victim", { ...VICTIM, status: "missing", search: "foundAlive" }, { cancelled: true })],
        new Set(),
        null,
      ),
    ).toMatchObject({ missing: null });
    expect(
      recapOf([record("evacuee", { entered: "2026-11-30", age: 30, sex: "male" })], new Set(), "2026-11-25"),
    ).toMatchObject({ displaced: 0 });
    expect(
      recapOf([record("evacuee", { entered: "2026-11-30", age: 30, sex: "male" })], new Set(), null),
    ).toMatchObject({
      displaced: null,
    });
  });

  test("only known names may be marked nil", () => {
    expect([...NIL_METRICS]).toEqual([
      "dead",
      "missing",
      "injured",
      "displaced",
      "housesHeavy",
      "housesModerate",
      "housesLight",
      "housesFlooded",
      "infrastructureCut",
      "roadKm",
      "bridgeHeavy",
      "bridgeModerate",
      "bridgeLight",
      "powerUnits",
      "waterUnits",
      "signalUnits",
      "irrigationUnits",
      "transportUnits",
      "fuelStationUnits",
      "schoolHeavy",
      "schoolModerate",
      "schoolLight",
      "healthFacilityHeavy",
      "healthFacilityModerate",
      "healthFacilityLight",
      "worshipHeavy",
      "worshipModerate",
      "worshipLight",
      "officeHeavy",
      "officeModerate",
      "officeLight",
      "marketHeavy",
      "marketModerate",
      "marketLight",
    ]);
  });

  test("a metric with records can no longer be nil; a new record drops its nil", () => {
    const records = [
      record("victim", { ...VICTIM, status: "missing", search: "foundAlive" }),
      record("evacuee", { entered: "2026-11-24", left: "2026-11-25", age: 30, sex: "male" }),
      record("infrastructure", { type: "school", damage: "light", function: "working" }),
      record("house", { damage: "heavy", flooded: false }),
    ];
    expect([...metricsWithRecords(records)].sort()).toEqual([
      "displaced",
      "housesHeavy",
      "infrastructureCut",
      "missing",
      "schoolLight",
    ]);
    expect([...dropFilledNil(new Set(["housesHeavy", "dead", "displaced"]), records)]).toEqual(["dead"]);
    expect([...metricsWithRecords([record("victim", { ...VICTIM, status: "dead" })])]).toEqual(["dead"]);
  });
});

describe("the state an event closes in", () => {
  test("done only with no one missing, no one displaced and nothing cut, each known", () => {
    expect(finalState({ missing: 0, displaced: 0, infrastructureCut: 0, dead: 2, housesHeavy: null })).toEqual({
      status: "done",
      reasons: [],
      notRecorded: ["housesHeavy"],
    });
    expect(finalState({ missing: 2, displaced: null, infrastructureCut: 0, dead: null })).toEqual({
      status: "doneNoted",
      reasons: [
        { metric: "missing", value: 2 },
        { metric: "displaced", value: null },
      ],
      notRecorded: ["dead"],
    });
    expect(finalState({})).toMatchObject({
      status: "doneNoted",
      reasons: [
        { metric: "missing", value: null },
        { metric: "displaced", value: null },
        { metric: "infrastructureCut", value: null },
      ],
    });
  });
});

describe("the sealed version", () => {
  test("is canonical JSON: keys in order, undefined left out", () => {
    expect(canonical({ b: [1, { d: null, c: "x" }], a: undefined, e: true })).toBe(
      '{"b":[1,{"c":"x","d":null}],"e":true}',
    );
    expect(canonical("x")).toBe('"x"');
    expect(canonical(null)).toBe("null");
  });

  test("holds totals, state and closing, and each live record by its keyed fingerprint only", async () => {
    const records = [
      record("house", { damage: "heavy" }, { id: "b000000000000000", seq: 2, personal: { headOfFamily: "Uji" } }),
      record("house", { damage: "light" }, { id: "a000000000000000", seq: 1 }),
      record("house", {}, { id: "c000000000000000", cancelled: true }),
    ];
    const seen: string[] = [];
    const body = await sealedBody(
      { id: "f000000000000000", ticketNumber: "LA-241126-01", regencyCode: "11.08" },
      records,
      {
        recap: { housesHeavy: 1 },
        final: { status: "done", reasons: [], notRecorded: [] },
        closing: { endedOn: "2026-11-27" },
      },
      async (text) => {
        seen.push(text);
        return `sig${seen.length}`;
      },
    );
    expect(JSON.parse(body)).toEqual({
      file: { id: "f000000000000000", ticketNumber: "LA-241126-01", regencyCode: "11.08" },
      recap: { housesHeavy: 1 },
      final: { status: "done", reasons: [], notRecorded: [] },
      closing: { endedOn: "2026-11-27" },
      records: [
        { id: "a000000000000000", kind: "house", seq: 1, fingerprint: expect.stringMatching(/^sig/) },
        { id: "b000000000000000", kind: "house", seq: 2, fingerprint: expect.stringMatching(/^sig/) },
      ],
    });
    expect(body).not.toContain("Uji");
    expect(seen.sort()).toEqual([
      '{"data":{"damage":"heavy"},"personal":{"headOfFamily":"Uji"}}',
      '{"data":{"damage":"light"},"personal":{}}',
    ]);
  });
});
