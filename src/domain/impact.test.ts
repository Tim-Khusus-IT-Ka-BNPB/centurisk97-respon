import { describe, expect, test } from "vitest";
import { impactOf } from "./impact";

const value = (n: number) => ({ state: "value", value: n });
const none = { state: "none" };
const unknown = { state: "confirmedUnknown" };

describe("report impact on the desk", () => {
  test("a count is kept, an explicit none is 0, anything not known is null", () => {
    expect(
      impactOf({ dead: value(2), missing: none, injured: unknown, displacedPeople: { state: "notYetKnown" } }),
    ).toEqual({ dead: 2, missing: 0, injured: null, displaced: null, houses: null });
  });

  test("houses add up their three kinds, and say when one of them is not known", () => {
    expect(impactOf({ housesHeavy: value(3), housesModerate: none, housesLight: value(2) }).houses).toEqual({
      count: 5,
      partial: false,
    });
    expect(impactOf({ housesHeavy: value(3), housesModerate: unknown }).houses).toEqual({ count: 3, partial: true });
    expect(impactOf({ housesHeavy: none, housesModerate: none, housesLight: none }).houses).toEqual({
      count: 0,
      partial: false,
    });
    expect(impactOf({ housesLight: value(1) }).houses).toEqual({ count: 1, partial: true });
    expect(impactOf({}).houses).toBeNull();
  });
});
