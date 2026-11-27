import { expect, test } from "vitest";
import { hazardDot, ringGradient } from "./hazardColors";

test("each hazard its colour, an unknown one grey; the ring's slices by their share", () => {
  expect(hazardDot("flood")).toBe("bg-[#2563eb]");
  expect(hazardDot("other")).toBe("bg-[#64748b]");
  expect(
    ringGradient([
      { hazardType: "flood", count: 1 },
      { hazardType: "other", count: 3 },
    ]),
  ).toBe("conic-gradient(#2563eb 0deg 90deg, #64748b 90deg 360deg)");
});
