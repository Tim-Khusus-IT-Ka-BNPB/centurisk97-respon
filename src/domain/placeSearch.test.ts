import { describe, expect, test } from "vitest";
import { areaLevelOf, checkPlaceQuery, PLACE_RESULTS } from "./placeSearch";

describe("place search rules", () => {
  test("10 across the country, 40 inside an area", () => {
    expect(PLACE_RESULTS).toEqual({ country: 10, area: 40 });
  });

  test.each([
    ["11.08", "regency"],
    ["11.08.01", "district"],
    ["11.08.01.2001", null],
    ["11.8", null],
    ["x11.08", null],
    ["11.08x", null],
    ["11.08.0", null],
    ["x11.08.01", null],
    ["", null],
  ])("%s names a %s", (code, level) => {
    expect(areaLevelOf(code)).toBe(level);
  });

  test("across the country a query needs 3 to 60 characters, spaces around it not counted", () => {
    const tooShort = { fieldId: "q", rule: "query.tooShort", params: {} };
    const tooLong = { fieldId: "q", rule: "query.tooLong", params: {} };
    expect(checkPlaceQuery("  ab  ", false)).toEqual(tooShort);
    expect(checkPlaceQuery("abc", false)).toBeNull();
    expect(checkPlaceQuery("a".repeat(60), false)).toBeNull();
    expect(checkPlaceQuery("a".repeat(61), false)).toEqual(tooLong);
  });

  test("inside an area the filter may be empty but not over 60 characters", () => {
    expect(checkPlaceQuery("", true)).toBeNull();
    expect(checkPlaceQuery("a".repeat(60), true)).toBeNull();
    expect(checkPlaceQuery("a".repeat(61), true)).toEqual({ fieldId: "q", rule: "query.tooLong", params: {} });
  });
});
