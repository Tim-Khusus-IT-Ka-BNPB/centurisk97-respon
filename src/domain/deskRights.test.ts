import { describe, expect, test } from "vitest";
import { type DeskCapability, mayUse } from "./deskRights";

// Who may do what on the desk: a regional officer works its region's reports, asks for identity,
// and neither forwards nor reopens.
const RIGHTS: readonly (readonly [DeskCapability, boolean, boolean])[] = [
  ["readQueue", true, true],
  ["readReport", true, true],
  ["markSeen", true, true],
  ["moveTicket", true, true],
  ["forwardTicket", true, false],
  ["reopenTicket", true, false],
  ["reply", true, true],
  ["checkField", true, true],
  ["addHandling", true, true],
  ["readIdentity", true, false],
  ["revealIdentity", false, true],
];

describe("desk capabilities", () => {
  test.each(RIGHTS)("%s: desk officer %s, regional officer %s", (capability, deskOfficer, regionalOfficer) => {
    expect(mayUse("deskOfficer", capability)).toBe(deskOfficer);
    expect(mayUse("regionalOfficer", capability)).toBe(regionalOfficer);
  });
});
