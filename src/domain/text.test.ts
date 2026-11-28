import { describe, expect, test } from "vitest";
import { modernSpelling, nearWords, placeQueryWords, placeSearchText, placeTries } from "./placeText";
import { folded, tidy, wordsOf } from "./text";

describe("text helpers", () => {
  test("tidy keeps one space and drops control characters", () => {
    expect(tidy("  a\u0000b\t\nc   d  ")).toBe("a b c d");
    expect(tidy("Ａ")).toBe("A");
  });

  test("folded is lower case without emphasis and quote marks", () => {
    expect(folded(` *A_b~c\`d"e'f‘g’h“i”J `)).toBe("abcdefghij");
  });

  test("words are letters and digits", () => {
    expect(wordsOf("Rumah-rusak, 3 KK!")).toEqual(["rumah", "rusak", "3", "kk"]);
    expect(wordsOf("  ")).toEqual([]);
  });
});

describe("place text", () => {
  test("search text is lower case letters and digits", () => {
    expect(placeSearchText("Sukamaju", "Kab. Contoh-2", "Cibeber (Kota)")).toBe("sukamaju kab contoh 2 cibeber kota");
  });

  test("query words: one letter words and kind words dropped, five at most", () => {
    expect(placeQueryWords("  Desa  a Sukamaju, Kec. B Cibeber satu dua tiga empat")).toEqual([
      "sukamaju",
      "cibeber",
      "satu",
      "dua",
      "tiga",
    ]);
    expect(placeQueryWords("Kelurahan Kampung Melayu")).toEqual(["kampung", "melayu"]);
    expect(placeQueryWords("kabupaten Bogor, kel. Tegal")).toEqual(["bogor", "tegal"]);
    expect(placeQueryWords("Kab. Aceh Utara kecamatan Baktiya")).toEqual(["aceh", "utara", "baktiya"]);
    // Kind words alone are all there is to search.
    expect(placeQueryWords("desa kec")).toEqual(["desa", "kec"]);
    expect(placeQueryWords("!!")).toEqual([]);
  });
});

describe("near spellings of a place word", () => {
  test("itself, each letter left out, swapped for any letter, or one more anywhere", () => {
    expect(nearWords("abcd")).toEqual([
      "abcd",
      "bcd",
      "_bcd",
      "acd",
      "a_cd",
      "abd",
      "ab_d",
      "abc",
      "abc_",
      "_abcd",
      "a_bcd",
      "ab_cd",
      "abc_d",
      "abcd_",
    ]);
    expect(nearWords("abcdefghiklmnopqrstu")).toHaveLength(1 + 20 + 20 + 21);
    expect(nearWords("soekamadjoe")).toContain("sukamaju");
  });

  test("a word under 4 or over 20 letters is only itself", () => {
    expect(nearWords("abc")).toEqual(["abc"]);
    expect(nearWords("a".repeat(21))).toEqual(["a".repeat(21)]);
  });

  test("the old spelling is read in the new one", () => {
    expect(modernSpelling("djakarta")).toBe("jakarta");
    expect(modernSpelling("tjilatjap")).toBe("cilacap");
    expect(modernSpelling("soerabaja")).toBe("surabaya");
    expect(modernSpelling("jogjakarta")).toBe("yogyakarta");
    expect(modernSpelling("njamuk sjarif")).toBe("nyamuk syarif");
    expect(modernSpelling("chairul")).toBe("khairul");
    expect(modernSpelling("sukamaju")).toBe("sukamayu");
  });
});

describe("a place named in a message, tried for the search", () => {
  test("whole, then with each last part left off", () => {
    expect(placeTries("desa Cot Seumiyong, kec. Samudera, Aceh Utara")).toEqual([
      "desa Cot Seumiyong, kec. Samudera, Aceh Utara",
      "desa Cot Seumiyong, kec. Samudera",
      "desa Cot Seumiyong",
    ]);
    expect(placeTries(" Sukamaju ")).toEqual(["Sukamaju"]);
    expect(placeTries("Sukamaju,, ")).toEqual(["Sukamaju"]);
    expect(placeTries(" , ")).toEqual([]);
  });
});
