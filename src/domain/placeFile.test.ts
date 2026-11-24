import { describe, expect, test } from "vitest";
import { checkPlaceFile, placeRecords, UPSTREAM_FLOOR } from "./placeFile";

const PROVINCES = { "11": "Aceh", "81": "Maluku" };
const file = (overrides: Record<string, unknown> = {}) => ({
  dibuat: "2026-10-25",
  sumber: "test source",
  kab: { "11.08": "Aceh Utara", "81.72": "Kota Tual" },
  baris: [
    ["11.08.01.2001", "Blang Jruen", "Tanah Luas"],
    ["11.08.01.2002", " Sukamaju ", " Tanah Luas "],
    ["11.08.02.2001", "Matang", "Samudera"],
    ["81.72.01.2001", "Fiditan", "Pulau Dullah Utara"],
  ],
  ...overrides,
});

describe("place file contract", () => {
  test("a well formed file passes with its data date and source", () => {
    const checked = checkPlaceFile(file(), PROVINCES, false);
    expect(checked.ok && [checked.file.dataDate, checked.file.source, checked.file.rows.length]).toEqual([
      "2026-10-25",
      "test source",
      4,
    ]);
  });

  test.each([
    ["no object", null],
    ["nothing", undefined],
    ["a number", 5],
    ["a list", []],
    ["no source", file({ sumber: 3 })],
    ["no regency map", file({ kab: undefined })],
    ["an empty regency map value", file({ kab: null })],
    ["a regency map that is a list", file({ kab: ["Aceh Utara"] })],
    ["an empty regency name", file({ kab: { "11.08": "" } })],
    ["a regency name that is not text", file({ kab: { "11.08": 5 } })],
    ["one bad regency name among good ones", file({ kab: { ...file().kab, "11.09": "" } })],
    ["no rows", file({ baris: {} })],
  ])("%s is refused as malformed", (_label, json) => {
    expect(checkPlaceFile(json, PROVINCES, false)).toEqual({ ok: false, problem: { kind: "shape" } });
  });

  test.each([
    ["missing", undefined],
    ["not a date", "kemarin"],
    ["no such day", "2026-02-30"],
    ["a number", 20261025],
  ])("a data date %s is refused", (_label, dibuat) => {
    expect(checkPlaceFile(file({ dibuat }), PROVINCES, false)).toEqual({ ok: false, problem: { kind: "dataDate" } });
  });

  test.each([
    ["a short code", ["11.08.01.201", "Blang", "Tanah"]],
    ["a code with more before it", ["x11.08.01.2009", "Blang", "Tanah"]],
    ["a code inside a list", [["11.08.01.2009"], "Blang", "Tanah"]],
    ["a code with more after it", ["11.08.01.20091", "Blang", "Tanah"]],
    ["a code with letters", ["11.08.01.20a1", "Blang", "Tanah"]],
    ["a code that is not text", [1108012001, "Blang", "Tanah"]],
    ["a blank name", ["11.08.01.2009", "  ", "Tanah"]],
    ["a name that is not text", ["11.08.01.2009", 7, "Tanah"]],
    ["a blank district", ["11.08.01.2009", "Blang", " "]],
    ["a district that is not text", ["11.08.01.2009", "Blang", null]],
    ["two cells", ["11.08.01.2009", "Blang"]],
    ["four cells", ["11.08.01.2009", "Blang", "Tanah", "x"]],
    ["not a list", "11.08.01.2009"],
  ])("a row with %s is refused by its index", (_label, row) => {
    const rows = [...file().baris, row];
    expect(checkPlaceFile(file({ baris: rows }), PROVINCES, false)).toEqual({
      ok: false,
      problem: { kind: "row", index: 4 },
    });
  });

  test("a village code twice, a regency or province not listed, are each refused naming the code", () => {
    const base = file().baris;
    const check = (row: string[]) => checkPlaceFile(file({ baris: [...base, row] }), PROVINCES, false);
    expect(check(["11.08.01.2001", "Lain", "Tanah"])).toEqual({
      ok: false,
      problem: { kind: "duplicate", code: "11.08.01.2001" },
    });
    expect(check(["11.09.01.2001", "Lain", "Tanah"])).toEqual({
      ok: false,
      problem: { kind: "noRegency", code: "11.09.01.2001" },
    });
    const kab = { ...file().kab, "99.01": "Nowhere" };
    expect(
      checkPlaceFile(file({ kab, baris: [...base, ["99.01.01.2001", "Lain", "Tanah"]] }), PROVINCES, false),
    ).toEqual({ ok: false, problem: { kind: "noProvince", code: "99.01.01.2001" } });
  });

  test("an empty file is a false empty even without the floor", () => {
    expect(checkPlaceFile(file({ baris: [] }), PROVINCES, false)).toEqual({
      ok: false,
      problem: { kind: "tooFew", villages: 0, regencies: 0 },
    });
  });

  test("with the floor, a file under 80,000 villages or 500 regencies is a false empty", () => {
    expect(checkPlaceFile(file(), PROVINCES, true)).toEqual({
      ok: false,
      problem: { kind: "tooFew", villages: 4, regencies: 2 },
    });
    expect(UPSTREAM_FLOOR).toEqual({ villages: 80_000, regencies: 500 });
  });

  test("with the floor, a file at both floors passes, and one short of either is refused", () => {
    const provinces: Record<string, string> = {};
    const sized = (villages: number, regencies: number) => {
      const kab: Record<string, string> = {};
      const codes: string[] = [];
      for (let r = 0; r < regencies; r += 1) {
        const province = String(11 + Math.floor(r / 100));
        provinces[province] = `Province ${province}`;
        const code = `${province}.${String(r % 100).padStart(2, "0")}`;
        kab[code] = `Regency ${r}`;
        codes.push(code);
      }
      const baris = Array.from({ length: villages }, (_, v) => [
        `${codes[v % regencies]}.01.${String(Math.floor(v / regencies)).padStart(4, "0")}`,
        `Village ${v}`,
        "District",
      ]);
      return file({ kab, baris });
    };
    const { villages, regencies } = UPSTREAM_FLOOR;
    expect(checkPlaceFile(sized(villages, regencies), provinces, true).ok).toBe(true);
    expect(checkPlaceFile(sized(villages - 1, regencies), provinces, true)).toEqual({
      ok: false,
      problem: { kind: "tooFew", villages: villages - 1, regencies },
    });
    expect(checkPlaceFile(sized(villages, regencies - 1), provinces, true)).toEqual({
      ok: false,
      problem: { kind: "tooFew", villages, regencies: regencies - 1 },
    });
  });
});

describe("snapshot records", () => {
  test("villages keep trimmed names, and each regency and district counts its villages", () => {
    const checked = checkPlaceFile(file(), PROVINCES, false);
    if (!checked.ok) throw new Error("fixture refused");
    const records = placeRecords(checked.file, PROVINCES);
    expect(records.villages[1]).toEqual({
      code: "11.08.01.2002",
      name: "Sukamaju",
      districtName: "Tanah Luas",
      regencyCode: "11.08",
      regencyName: "Aceh Utara",
      provinceCode: "11",
      provinceName: "Aceh",
    });
    expect(records.regencies).toEqual([
      { code: "11.08", name: "Aceh Utara", provinceCode: "11", provinceName: "Aceh", villageCount: 3 },
      { code: "81.72", name: "Kota Tual", provinceCode: "81", provinceName: "Maluku", villageCount: 1 },
    ]);
    expect(records.districts.map((d) => [d.code, d.name, d.regencyName, d.villageCount])).toEqual([
      ["11.08.01", "Tanah Luas", "Aceh Utara", 2],
      ["11.08.02", "Samudera", "Aceh Utara", 1],
      ["81.72.01", "Pulau Dullah Utara", "Kota Tual", 1],
    ]);
  });
});
