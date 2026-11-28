import { describe, expect, test } from "vitest";
import { text } from "../testing/render";
import { factText, parseFacts } from "./noted";

describe("what Sigap read, as the reporter reads it back", () => {
  test("counts in a phrase of their own, a none as 'Tidak ada'", () => {
    expect(factText(text, { field: "housesFlooded", value: 1250 })).toBe("1.250 rumah terendam");
    expect(factText(text, { field: "dead", value: null })).toBe("Tidak ada orang meninggal");
  });

  test("a choice and several by their labels, a text as typed", () => {
    expect(factText(text, { field: "waterDepth", value: "waist" })).toBe("Tinggi air: Sepinggang");
    expect(factText(text, { field: "urgentNeeds", value: ["readyMeals", "drinkingWater"] })).toMatch(
      /^Kebutuhan mendesak: .+, .+$/,
    );
    expect(factText(text, { field: "trapped", value: null })).toMatch(/: Tidak ada$/);
    expect(factText(text, { field: "shelters", value: "balai desa" })).toBe("Titik pengungsian: balai desa");
  });

  test("the stored line is read back; anything broken or unknown is left out", () => {
    expect(parseFacts('[{"field":"dead","value":2},{"field":"rahasia","value":1},null]')).toEqual([
      { field: "dead", value: 2 },
    ]);
    expect(parseFacts("{")).toEqual([]);
    expect(parseFacts('{"field":"dead"}')).toEqual([]);
    expect(parseFacts(undefined)).toEqual([]);
  });
});
