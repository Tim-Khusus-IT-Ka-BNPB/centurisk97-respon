import { describe, expect, test } from "vitest";
import { type DeskCapability, mayUse } from "./deskRights";

const ALL: readonly DeskCapability[] = ["readQueue", "readReport", "markSeen"];

describe("desk capabilities", () => {
  test.each(ALL)("a desk officer may %s", (capability) => {
    expect(mayUse("deskOfficer", capability)).toBe(true);
  });

  test.each(ALL)("a regional officer may not %s before region scope exists", (capability) => {
    expect(mayUse("regionalOfficer", capability)).toBe(false);
  });
});
