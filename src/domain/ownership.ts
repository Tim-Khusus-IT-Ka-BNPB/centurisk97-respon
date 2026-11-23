import type { Principal } from "../ports/identity";

type Owned = { readonly reporterId: string; readonly ownerSlot: string };

// A draft is read only from the device that made it, or by the session of its number, which also
// reads that number's device drafts. Anyone else is told it does not exist.
export function ownsDraft(principal: Principal, draft: Owned): boolean {
  switch (principal.kind) {
    case "device":
      return draft.ownerSlot === principal.deviceId;
    case "session":
      return draft.reporterId === principal.reporterId;
    default:
      return false;
  }
}

// The slot a principal's own drafts and profiles live in.
export function ownerSlotOf(principal: Principal): string | null {
  if (principal.kind === "device") return principal.deviceId;
  return principal.kind === "session" ? "session" : null;
}
