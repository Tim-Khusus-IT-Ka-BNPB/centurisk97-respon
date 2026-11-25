import { expect, test } from "vitest";
import { tallyOf } from "./tally";

test("counts above zero, explicit none and not known are told apart, in the order asked for", () => {
  expect(
    tallyOf(
      {
        dead: { state: "value", value: 2, origin: "boxEntry" },
        missing: { state: "none", origin: "boxEntry" },
        injured: { state: "notYetKnown" },
        injuredInpatient: { state: "value", value: 1, origin: "boxEntry" },
      },
      ["injuredInpatient", "dead", "missing", "injured", "schools"],
    ),
  ).toEqual({
    counts: [
      { fieldId: "injuredInpatient", count: 1 },
      { fieldId: "dead", count: 2 },
    ],
    none: ["missing"],
    unknown: ["injured", "schools"],
  });
});
