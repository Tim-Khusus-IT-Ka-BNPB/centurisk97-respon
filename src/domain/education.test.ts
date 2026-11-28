import { describe, expect, test } from "vitest";
import seeded from "../../db/reference/education.json";
import { checkEducationFile } from "./education";

const source = { lembaga: "BNPB", judul: "Buku saku", url: "https://bnpb.go.id/" };
const topic = { id: "banjir", judul: "Banjir", ringkas: "Air meluap.", sebelum: ["Siapkan tas"], sumber: [source] };
const file = (topik: unknown[], extra: object = {}) => ({ dibuat: "2026-11-19", catatan: "", topik, ...extra });

describe("education file", () => {
  test("the seeded file and a minimal one pass", () => {
    expect(checkEducationFile(seeded)?.topik).toHaveLength(3);
    expect(checkEducationFile(file([topic]))?.dibuat).toBe("2026-11-19");
  });

  test("a source not over https is left out, and the topic stands on the ones that are", () => {
    const plain = { ...source, url: "http://www.kemkes.go.id/" };
    expect(checkEducationFile(file([{ ...topic, sumber: [plain, source] }]))?.topik[0]?.sumber).toEqual([source]);
  });

  test("a file or topic that breaks its contract is refused", () => {
    for (const broken of [
      null,
      file([topic], { dibuat: "19 Nov" }),
      file([topic], { catatan: 1 }),
      file([]),
      { dibuat: "2026-11-19", catatan: "", topik: "x" },
      file([{ ...topic, judul: " " }]),
      file([{ ...topic, sebelum: "x" }]),
      file([{ ...topic, saat: [""] }]),
      file([{ ...topic, sumber: [] }]),
      file([{ ...topic, sumber: [{ ...source, url: "http://bnpb.go.id/" }] }]),
      file([{ ...topic, sumber: [null] }]),
      file([topic, topic]),
      file([null]),
      file([{ ...topic, sebelum: ["Siapkan tas", ""] }]),
      file([{ ...topic, sumber: [source, null] }]),
      file([{ ...topic, sumber: [{ ...source, url: "ftp://https://bnpb.go.id/" }] }]),
      file([topic, null]),
      file([topic], { dibuat: "x2026-11-19" }),
      file([topic], { dibuat: "2026-11-19x" }),
    ])
      expect(checkEducationFile(broken)).toBeNull();
  });
});
