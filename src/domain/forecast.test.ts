import { describe, expect, test } from "vitest";
import SEED from "../../db/reference/forecast.json";
import { cellLevel, checkForecastFile, type ForecastFile, outlookOf, warningsOf } from "./forecast";

describe("the outlook file", () => {
  test("the seed passes its contract; a file without rain, regencies or a date does not", () => {
    expect(checkForecastFile(SEED)).not.toBeNull();
    expect(checkForecastFile({ ...SEED, dibuat: "kemarin" })).toBeNull();
    expect(checkForecastFile({ ...SEED, kab: [] })).toBeNull();
    expect(checkForecastFile({ ...SEED, kode: { BNJ: SEED.kode.BNJ } })).toBeNull();
    expect(checkForecastFile({ ...SEED, kode: [] })).toBeNull();
    expect(checkForecastFile({ ...SEED, kode: { ...SEED.kode, HJN: { label: "Hujan" } } })).toBeNull();
    expect(checkForecastFile({ ...SEED, kab: [{ id: "11", nama: "X", pn: "Y" }] })).toBeNull();
    expect(checkForecastFile({ ...SEED, waspada: [{ kab: "1108", tenggang: 1.5, maka: "x" }] })).toBeNull();
    expect(checkForecastFile(null)).toBeNull();
    expect(checkForecastFile({ ...SEED, kode: undefined })).toBeNull();
  });

  test("every code, regency and advice must keep its shape, one broken is enough", () => {
    const code = SEED.kode.BNJ;
    for (const broken of [
      null,
      { ...code, label: 1 },
      { ...code, hari: [...code.hari, 5] },
      { ...code, hari: "2026-11-26" },
      { ...code, kol: [...code.kol, 5] },
      { ...code, kol: "lv" },
    ])
      expect(checkForecastFile({ ...SEED, kode: { ...SEED.kode, X: broken } }), JSON.stringify(broken)).toBeNull();
    const regency = SEED.kab[0] as Record<string, unknown>;
    for (const broken of [
      null,
      { ...regency, id: "11080" },
      { ...regency, id: "x1108" },
      { ...regency, nama: 1 },
      { ...regency, pn: null },
    ])
      expect(checkForecastFile({ ...SEED, kab: [...SEED.kab, broken] }), JSON.stringify(broken)).toBeNull();
    expect(checkForecastFile({ ...SEED, kab: [{ ...regency, id: 1108 }] })).not.toBeNull();
    const advice = SEED.waspada[0] as Record<string, unknown>;
    for (const broken of [null, { ...advice, kab: 1108 }, { ...advice, maka: null }, { ...advice, tenggang: "1" }])
      expect(checkForecastFile({ ...SEED, waspada: [...SEED.waspada, broken] }), JSON.stringify(broken)).toBeNull();
    expect(checkForecastFile({ ...SEED, waspada: "x" })).toBeNull();
  });
});

describe("levels, as upstream reads them", () => {
  test("rain by its total in mm: under 20, 50 and 100", () => {
    const columns = ["tot"];
    expect([19.9, 20, 49.9, 50, 99.9, 100].map((mm) => cellLevel("HJN", columns, [mm]))).toEqual([0, 1, 1, 2, 2, 3]);
  });

  test("hot spots by chance, haze by class, tide by whether it passes, the rest by level", () => {
    expect([0.19, 0.2, 0.5, 0.8].map((p) => cellLevel("API", ["p"], [p]))).toEqual([0, 1, 2, 3]);
    expect([-1, 2, 5].map((kat) => cellLevel("ASP", ["kat"], [kat]))).toEqual([0, 2, 3]);
    expect([0, 1].map((past) => cellLevel("ROB", ["lewat"], [past]))).toEqual([0, 2]);
    expect(cellLevel("BNJ", ["lv", "ps"], [2, 0.4])).toBe(2);
  });

  test("no figure is no level, never Normal", () => {
    expect(cellLevel("HJN", ["tot"], [null])).toBeNull();
    expect(cellLevel("HJN", undefined, [1])).toBeNull();
    expect(cellLevel("HJN", ["tot"], undefined)).toBeNull();
  });
});

describe("a regency's three days", () => {
  test("rain, the threats above Normal, and the advice of each day", () => {
    const outlook = outlookOf(checkForecastFile(SEED) as never, "11.08");
    expect(outlook).toEqual({
      regencyName: "Kab. Aceh Utara",
      provinceName: "Aceh",
      madeAt: "2026-11-26T06:00:00+07:00",
      days: [
        {
          date: "2026-11-26",
          rainMm: 62,
          rainLevel: 2,
          threats: [
            { code: "BNJ", label: "Banjir", level: 2 },
            { code: "LSR", label: "Longsor", level: 1 },
          ],
        },
        { date: "2026-11-27", rainMm: 18, rainLevel: 0, threats: [{ code: "BNJ", label: "Banjir", level: 1 }] },
        { date: "2026-11-28", rainMm: 0, rainLevel: 0, threats: [] },
      ],
      advice: [{ date: "2026-11-26", text: "Siapkan tas siaga dan pantau ketinggian air sungai" }],
    });
  });

  test("a regency the file lacks has none; a day with no rain row is not known", () => {
    const file = checkForecastFile(SEED) as never;
    expect(outlookOf(file, "99.99")).toBeNull();
    const bare = checkForecastFile({
      ...SEED,
      kab: [{ id: "1108", nama: "A", pn: "B" }],
      waspada: [{ kab: "1108", tenggang: 9, maka: "x" }],
    });
    expect(outlookOf(bare as never, "11.08")?.days[0]).toEqual({
      date: "2026-11-26",
      rainMm: null,
      rainLevel: null,
      threats: [],
    });
    expect(outlookOf(bare as never, "11.08")?.advice).toEqual([]);
  });

  test("advice for the last day is kept, past it dropped", () => {
    const last = checkForecastFile({
      ...SEED,
      waspada: [
        { kab: "1108", tenggang: 3, maka: "lusa" },
        { kab: "1108", tenggang: 2, maka: "besok" },
        { kab: "1108", tenggang: 4, maka: "nanti" },
        { kab: "1108", tenggang: 0, maka: "kemarin" },
      ],
    });
    expect(outlookOf(last as never, "11.08")?.advice).toEqual([
      { date: "2026-11-28", text: "lusa" },
      { date: "2026-11-27", text: "besok" },
    ]);
  });
});

describe("the regencies on watch", () => {
  const regency = (id: string, nama: string, BNJ: number[], LSR: number[]) => ({
    id,
    nama,
    prov: id.slice(0, 2),
    pn: "Uji",
    HJN: [[0, 0, 0, 1, 0, null, null, 0]],
    BNJ: BNJ.map((lv) => [lv, 0]),
    LSR: LSR.map((lv) => [lv, 0]),
  });
  const file = (...kab: ReturnType<typeof regency>[]) => checkForecastFile({ ...SEED, kab }) as ForecastFile;

  test("each regency at Waspada or above on any day, by its highest level and the threats at it", () => {
    expect(warningsOf(SEED as unknown as ForecastFile).map((one) => [one.regencyCode, one.level])).toEqual([
      ["32.01", 3],
      ["11.08", 2],
    ]);
    expect(
      warningsOf(
        file(
          regency("1101", "Kab. Calm", [0, 0, 0], [0, 0, 0]),
          regency("1102", "Kab. Beta", [1, 0, 0], [0, 1, 0]),
          regency("1103", "Kab. Alfa", [1, 0, 0], [0, 0, 0]),
          regency("1104", "Kab. Zeta", [0, 3, 3], [0, 0, 3]),
        ),
      ),
    ).toEqual([
      { regencyCode: "11.04", regencyName: "Kab. Zeta", provinceName: "Uji", level: 3, threats: ["Banjir", "Longsor"] },
      { regencyCode: "11.03", regencyName: "Kab. Alfa", provinceName: "Uji", level: 1, threats: ["Banjir"] },
      { regencyCode: "11.02", regencyName: "Kab. Beta", provinceName: "Uji", level: 1, threats: ["Banjir", "Longsor"] },
    ]);
  });
});
