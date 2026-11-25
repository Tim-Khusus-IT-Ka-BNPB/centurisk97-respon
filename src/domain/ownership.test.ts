import { describe, expect, test } from "vitest";
import { ownerSlotOf, ownsDraft } from "./ownership";

const draft = { reporterId: "r1", ownerSlot: "d1" };

describe("who owns a draft", () => {
  test("the device that made it, or a session of its number; nobody else", () => {
    expect(ownsDraft({ kind: "device", deviceId: "d1" }, draft)).toBe(true);
    expect(ownsDraft({ kind: "device", deviceId: "d2" }, draft)).toBe(false);
    expect(ownsDraft({ kind: "session", reporterId: "r1" }, draft)).toBe(true);
    expect(ownsDraft({ kind: "session", reporterId: "r2" }, draft)).toBe(false);
    expect(
      ownsDraft(
        {
          kind: "staff",
          staffId: "staff-desk-1",
          role: "deskOfficer",
          label: "Petugas Uji",
          scope: { level: "national" },
          profile: null,
        },
        draft,
      ),
    ).toBe(false);
    expect(ownsDraft({ kind: "anonymous" }, draft)).toBe(false);
  });

  test("a chat owns what its number made there or in the main site's session, not on a phone", () => {
    const own = { reporterId: "r1", ownerSlot: "session" };
    expect(ownsDraft({ kind: "chat", reporterId: "r1" }, own)).toBe(true);
    expect(ownsDraft({ kind: "chat", reporterId: "r2" }, own)).toBe(false);
    expect(ownsDraft({ kind: "chat", reporterId: null }, own)).toBe(false);
    expect(ownsDraft({ kind: "chat", reporterId: "r1" }, draft)).toBe(false);
    expect(ownsDraft({ kind: "session", reporterId: "r1" }, own)).toBe(true);
  });

  test("the slot of a principal's own drafts", () => {
    expect(ownerSlotOf({ kind: "device", deviceId: "d1" })).toBe("d1");
    expect(ownerSlotOf({ kind: "session", reporterId: "r1" })).toBe("session");
    expect(ownerSlotOf({ kind: "chat", reporterId: "r1" })).toBe("session");
    expect(
      ownerSlotOf({
        kind: "staff",
        staffId: "staff-desk-1",
        role: "deskOfficer",
        label: "Petugas Uji",
        scope: { level: "national" },
        profile: null,
      }),
    ).toBeNull();
    expect(ownerSlotOf({ kind: "anonymous" })).toBeNull();
  });
});
