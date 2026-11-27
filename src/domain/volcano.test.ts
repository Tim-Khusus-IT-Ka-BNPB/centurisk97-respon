import { describe, expect, test } from "vitest";
import SEED from "../../db/reference/volcanoes.json";
import { checkVolcanoFile, type VolcanoFile, volcanoSummary } from "./volcano";

const one = { nama: "Uji", prov: "Jawa Timur", level: 3, radius_km: 5, laporan: "https://magma.esdm.go.id/v1/x" };
const file = (...gunung: (object | null)[]) => ({ sumber: "MAGMA", dibuat: "2026-11-10T15:47:44+07:00", gunung });

describe("the volcano file", () => {
  test("the seed passes; no source, date or volcano, or one broken volcano, does not", () => {
    expect(checkVolcanoFile(SEED)).not.toBeNull();
    expect(checkVolcanoFile(file(one))).not.toBeNull();
    expect(checkVolcanoFile(file({ ...one, radius_km: null, laporan: null }))).not.toBeNull();
    for (const broken of [
      null,
      { ...file(one), sumber: 1 },
      { ...file(one), dibuat: "kemarin" },
      { ...file(one), dibuat: 5 },
      file(),
      { ...file(one), gunung: "x" },
      file(one, null),
      file({ ...one, nama: 1 }),
      file({ ...one, prov: null }),
      file({ ...one, level: 0 }),
      file({ ...one, level: 5 }),
      file({ ...one, radius_km: -1 }),
      file({ ...one, radius_km: "5" }),
    ])
      expect(checkVolcanoFile(broken), JSON.stringify(broken)).toBeNull();
  });

  test("counts each level and lists Siaga and Awas, highest first, linking only MAGMA's own pages", () => {
    const summary = volcanoSummary(
      checkVolcanoFile(
        file(
          { ...one, nama: "Satu", level: 1 },
          { ...one, nama: "Dua", level: 2 },
          { ...one, nama: "Bromo", level: 3, laporan: "https://elsewhere.example/x" },
          { ...one, nama: "Awas", level: 4, radius_km: undefined },
          { ...one, nama: "Agung", level: 3 },
        ),
      ) as VolcanoFile,
    );
    expect(summary).toEqual({
      source: "MAGMA",
      madeAt: "2026-11-10T15:47:44+07:00",
      counts: [1, 1, 2, 1],
      raised: [
        { name: "Awas", province: "Jawa Timur", level: 4, radiusKm: null, report: one.laporan },
        { name: "Agung", province: "Jawa Timur", level: 3, radiusKm: 5, report: one.laporan },
        { name: "Bromo", province: "Jawa Timur", level: 3, radiusKm: 5, report: null },
      ],
    });
    expect(volcanoSummary(SEED as unknown as VolcanoFile).counts).toEqual([42, 24, 3, 0]);
  });
});
