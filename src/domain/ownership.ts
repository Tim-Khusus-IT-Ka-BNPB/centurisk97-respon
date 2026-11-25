import type { Principal } from "../ports/identity";

type Owned = { readonly reporterId: string; readonly ownerSlot: string };

// Which door a report came through.
export type Door = "web" | "chat";

// The slot of a number that is proved: by the main site's session, or by the chat it writes in.
export const SESSION_SLOT = "session";

// A draft is read only from the device that made it, or by the session of its number, which also
// reads that number's device drafts. A chat proves its number and reads what was made in the chat
// or in that session, not what somebody typed the number for on a phone (D100). Anyone else is told
// it does not exist.
export function ownsDraft(principal: Principal, draft: Owned): boolean {
  switch (principal.kind) {
    case "device":
      return draft.ownerSlot === principal.deviceId;
    case "session":
      return draft.reporterId === principal.reporterId;
    case "chat":
      return draft.reporterId === principal.reporterId && draft.ownerSlot === SESSION_SLOT;
    default:
      return false;
  }
}

// The slot a principal's own drafts and profiles live in.
export function ownerSlotOf(principal: Principal): string | null {
  if (principal.kind === "device") return principal.deviceId;
  return principal.kind === "session" || principal.kind === "chat" ? SESSION_SLOT : null;
}
