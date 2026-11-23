import { describe, expect, test } from "vitest";
import { placeQueryWords, placeSearchText } from "./placeText";
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

  test("query words: one letter words dropped, five at most", () => {
    expect(placeQueryWords("  Desa  a Sukamaju, Kec. B Cibeber satu dua tiga")).toEqual([
      "desa",
      "sukamaju",
      "kec",
      "cibeber",
      "satu",
    ]);
    expect(placeQueryWords("!!")).toEqual([]);
  });
});
