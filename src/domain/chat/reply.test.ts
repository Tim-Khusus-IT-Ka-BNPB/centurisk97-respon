import { describe, expect, test } from "vitest";
import {
  type Choice,
  readChoice,
  readDay,
  readHour,
  readNeighbourhood,
  readNumbers,
  saysSkip,
  saysUnknown,
} from "./reply";

const CHOICES: readonly Choice[] = [
  { id: "a", label: "Ya, ada" },
  { id: "b", label: "Banjir rob" },
  { id: "c", label: "Banjir bandang" },
  { id: "d", label: "Tidak ada" },
  { id: "e", label: "Lainnya", freeText: true },
];
const picked = (...ids: string[]) => ({ kind: "picked", ids, words: "" });
const WORDS = { kind: "words" };

describe("a choice", () => {
  test("by its number, however it is written", () => {
    for (const text of ["2", "2.", " 2) ", "2,"]) expect(readChoice(text, CHOICES), text).toEqual(picked("b"));
    expect(readChoice("5", CHOICES)).toEqual(picked("e"));
    expect(readChoice("2 2", CHOICES)).toEqual(picked("b"));
  });

  test("by its words, or the start of one alone", () => {
    expect(readChoice("banjir ROB.", CHOICES)).toEqual(picked("b"));
    expect(readChoice("*lainnya*", CHOICES)).toEqual(picked("e"));
    expect(readChoice("ya", CHOICES)).toEqual(picked("a"));
    expect(readChoice("tidak", CHOICES)).toEqual(picked("d"));
    // Two begin so, half a word is none, and nothing is nothing.
    for (const text of ["banjir", "lain", "tid", "", "banjir robek", "ada"])
      expect(readChoice(text, CHOICES), text).toEqual(WORDS);
    // A label may begin with a number; a full stop alone is still nothing.
    expect(readChoice(".", [{ id: "x", label: "3 sampai 12 jam" }])).toEqual(WORDS);
    expect(readChoice("3 sampai 12 jam", [{ id: "x", label: "3 sampai 12 jam" }])).toEqual(picked("x"));
    expect(readChoice("banjir rob..", CHOICES)).toEqual(picked("b"));
  });

  test("by its words among words that add nothing", () => {
    const choices: readonly Choice[] = [
      { id: "warga", label: "Warga" },
      { id: "only", label: "Listrik saja" },
      { id: "lone", label: "Listrik" },
    ];
    for (const text of ["saya warga", "warga aja", "warga saja sih", "Warga dong", "warga deh", "warga kak"])
      expect(readChoice(text, choices), text).toEqual(picked("warga"));
    for (const text of ["pak, warga", "wargaku", "sayawarga", "warga baru"])
      expect(readChoice(text, choices), text).toEqual(WORDS);
    expect(readChoice("warga, pak", choices)).toEqual(WORDS);
    expect(readChoice("bu warga pak", choices)).toEqual(picked("warga"));
    expect(readChoice("listrik saja", choices)).toEqual(picked("only"));
    expect(readChoice("listrik aja", choices)).toEqual(picked("lone"));
  });

  test("ya and tidak stand for the choice that means them", () => {
    const choices: readonly Choice[] = [
      { id: "agree", label: "Setuju", means: "yes" },
      { id: "decline", label: "Tidak setuju", means: "no" },
      { id: "none", label: "Tidak ada" },
    ];
    for (const text of [
      ...["ya", "Iya", "y", "ok", "oke", "betul", "benar", "mau", "boleh", "ya mau", "ya, boleh", "ok betul"],
      ...["ya dong", "iya kak", "iya benar", "saya mau"],
    ])
      expect(readChoice(text, choices), text).toEqual(picked("agree"));
    for (const text of [
      ...["tidak", "tdk", "bukan", "nggak", "enggak", "ga", "gak", "jangan", "tidak usah", "ga perlu", "tidak mau"],
      ...["tidak deh", "bukan pak"],
    ])
      expect(readChoice(text, choices), text).toEqual(picked("decline"));
    for (const text of [
      ...["yang", "oya", "okey", "tidakkah", "bukankah", "maukah", "si mau", "yamau", "tidakusah", "bukan usah"],
      ...["ya mau apa", "tidak usah itu", "saya", "jangan mau"],
    ])
      expect(readChoice(text, choices), text).toEqual(WORDS);
    expect(readChoice("ya", [{ id: "x", label: "Lanjut" }])).toEqual(WORDS);
  });

  test("a number off the list, or two where one is asked, is told so", () => {
    for (const text of ["0", "6", "99", "1 6"])
      expect(readChoice(text, CHOICES, true), text).toEqual({ kind: "outOfRange", max: 5 });
    expect(readChoice("1 2", CHOICES)).toEqual({ kind: "onlyOne" });
    expect(readChoice("1 6", CHOICES)).toEqual({ kind: "outOfRange", max: 5 });
  });

  test("several, by numbers or by words", () => {
    for (const text of ["1 2 4", "1,2,4", "1, 2 dan 4", "1 & 2 & 4", "1/2/4", "1. 2. 4.", "1;2;4", "1+2+4"])
      expect(readChoice(text, CHOICES, true), text).toEqual(picked("a", "b", "d"));
    const twelve = Array.from({ length: 12 }, (_, index) => ({ id: `n${index + 1}`, label: `Pilihan ${index + 1}` }));
    expect(readChoice("11 dan 12", twelve, true)).toEqual(picked("n11", "n12"));
    expect(readChoice("3 3 1", CHOICES, true)).toEqual(picked("c", "a"));
    for (const text of [
      "banjir rob, lainnya",
      "banjir rob,lainnya",
      "banjir rob , lainnya",
      "Banjir rob dan lainnya",
      "banjir rob & lainnya",
    ])
      expect(readChoice(text, CHOICES, true), text).toEqual(picked("b", "e"));
    expect(readChoice("banjir rob dan lainnya", CHOICES)).toEqual(WORDS);
    expect(readChoice("banjir rob, entah", CHOICES, true)).toEqual(WORDS);
    // A label that holds a comma is still read whole.
    expect(readChoice("ya, ada", CHOICES, true)).toEqual(picked("a"));
  });

  test("the words of a choice that asks for them come with its number", () => {
    expect(readChoice("5 Obat bayi", CHOICES)).toEqual({ kind: "picked", ids: ["e"], words: "Obat bayi" });
    expect(readChoice("5. Obat bayi", CHOICES)).toEqual({ kind: "picked", ids: ["e"], words: "Obat bayi" });
    expect(readChoice("1 5 Obat bayi", CHOICES, true)).toEqual({ kind: "picked", ids: ["a", "e"], words: "Obat bayi" });
    // Not one of one, not a choice that asks for words, or off the list: a sentence.
    for (const text of ["1 5 Obat bayi", "2 orang meninggal", "9 rumah", "5 6 obat", "123", "12 rumah"])
      expect(readChoice(text, CHOICES), text).toEqual(WORDS);
    expect(readChoice("1 9 5 obat", CHOICES, true)).toEqual(WORDS);
    expect(readChoice("dua orang", CHOICES)).toEqual(WORDS);
  });
});

describe("counts", () => {
  test("one value for each, in order", () => {
    expect(readNumbers("2 0 -", 3)).toEqual({ kind: "values", values: ["2", "0", ""] });
    expect(readNumbers("2, 0 ; ?", 3)).toEqual({ kind: "values", values: ["2", "0", ""] });
    expect(readNumbers("2,0;?", 3)).toEqual({ kind: "values", values: ["2", "0", ""] });
    expect(readNumbers("1.250/3", 2)).toEqual({ kind: "values", values: ["1.250", "3"] });
    expect(readNumbers(" 7 ", 1)).toEqual({ kind: "values", values: ["7"] });
    expect(readNumbers("lewati", 2)).toEqual({ kind: "values", values: ["", ""] });
  });

  test("none or not known for all of them", () => {
    for (const text of ["tidak ada", "Tidak ada semua", "nihil."])
      expect(readNumbers(text, 3), text).toEqual({ kind: "all", action: "allNone" });
    for (const text of ["tidak tahu", "belum tahu", "tidak diketahui", "belum diketahui", "ga tahu", "gak tahu"])
      expect(readNumbers(text, 3), text).toEqual({ kind: "all", action: "allUnknown" });
  });

  test("fewer or more than asked do not say which they are for", () => {
    expect(readNumbers("2 0", 3)).toEqual({ kind: "wrongCount", given: 2 });
    expect(readNumbers("2 0 1 1", 3)).toEqual({ kind: "wrongCount", given: 4 });
    expect(readNumbers("0", 2)).toEqual({ kind: "wrongCount", given: 1 });
  });

  test("anything else is words", () => {
    for (const text of ["dua meninggal", "2 orang", "2x 0", "x2 0", "--", "-1", "2-", "tidak ada korban", "belum", ""])
      expect(readNumbers(text, 2), text).toEqual(WORDS);
  });
});

describe("words for not known and for passing over", () => {
  test("whole", () => {
    expect(saysUnknown("Tidak tahu.")).toBe(true);
    for (const text of ["tidak tahu pasti", "saya tidak tahu", "tahu", "gatahu"]) expect(saysUnknown(text)).toBe(false);
    for (const text of ["lewati", "Lewat", "kosong"]) expect(saysSkip(text), text).toBe(true);
    for (const text of ["lewati saja", "jangan lewat", "tidak ada semuanya"]) expect(saysSkip(text), text).toBe(false);
  });

  test("none, whole", () => {
    for (const text of ["tidak ada semuanya", "memang tidak ada", "tidak adalah", "sudah nihil", "nihilan"])
      expect(readNumbers(text, 2), text).toEqual(WORDS);
  });
});

describe("an hour", () => {
  test("a clock, a bare hour, or not known", () => {
    expect(readHour("14.30")).toEqual({ hour: "14:30" });
    expect(readHour("jam 2 siang")).toEqual({ hour: "14:00" });
    expect(readHour("7")).toEqual({ hour: "7.00" });
    expect(readHour("14")).toEqual({ hour: "14.00" });
    for (const text of ["tidak tahu", "belum tahu", "-"]) expect(readHour(text), text).toEqual({ hour: null });
    for (const text of ["pagi", "123", "a7", "7a", ""]) expect(readHour(text), text).toBeNull();
  });
});

describe("RT and RW", () => {
  test("named, as a pair, or not known", () => {
    expect(readNeighbourhood("RT 4 RW 2")).toEqual({ rt: "4", rw: "2" });
    expect(readNeighbourhood("rt.004/rw.002")).toEqual({ rt: "004", rw: "002" });
    expect(readNeighbourhood("RW: 12")).toEqual({ rt: "", rw: "12" });
    expect(readNeighbourhood("rt4")).toEqual({ rt: "4", rw: "" });
    expect(readNeighbourhood("004/012")).toEqual({ rt: "004", rw: "012" });
    expect(readNeighbourhood("12 10")).toEqual({ rt: "12", rw: "10" });
    for (const text of ["4/2", "4 / 2", "4 /2", "4/ 2", "4 2"])
      expect(readNeighbourhood(text), text).toEqual({ rt: "4", rw: "2" });
    expect(readNeighbourhood("rt 4567")).toEqual({ rt: "4567", rw: "" });
    for (const text of ["tidak tahu", "-"]) expect(readNeighbourhood(text), text).toBe("unknown");
    for (const text of ["4", "dekat masjid", "art 4", "crw 2", "4-2", "a 4 2", "4 2 a", ""])
      expect(readNeighbourhood(text), text).toBeNull();
  });
});

describe("a day", () => {
  test("by its number, with the hour or without", () => {
    expect(readDay("1")).toEqual({ day: "today", hour: undefined });
    expect(readDay("2.")).toEqual({ day: "yesterday", hour: undefined });
    expect(readDay("3)")).toEqual({ day: "olderThan30Days", hour: undefined });
    expect(readDay("1 14.30")).toEqual({ day: "today", hour: "14:30" });
    expect(readDay("2. jam 5 sore")).toEqual({ day: "yesterday", hour: "17:00" });
    expect(readDay("1 tidak tahu")).toEqual({ day: "today", hour: null });
  });

  test("a date or a sentence is words", () => {
    for (const text of ["1 November 2026", "3 14.30", "4", "0", "14.30", "kemarin", "1.30", "12", "a 1", ""])
      expect(readDay(text), text).toBeNull();
  });
});
