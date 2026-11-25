import { type DeskCapability, mayUse, type StaffRole } from "./deskRights";
import type { FieldError } from "./identityForm";
import { LENGTHS } from "./limits";
import type { TicketStatus } from "./stages";

// How staff may move a ticket along, and what each move must say. A new ticket becomes seen only
// by being opened, never by a move.

export const NEXT_STATUSES: Readonly<Record<TicketStatus, readonly TicketStatus[]>> = {
  new: [],
  seen: ["under_review", "invalid"],
  under_review: ["forwarded", "in_handling", "invalid"],
  forwarded: ["in_handling", "invalid"],
  in_handling: ["closed", "invalid"],
  closed: ["under_review"],
  invalid: ["under_review"],
};

// What the note must hold: nothing, something, or a reason the reporter will read.
export type NoteRule = "optional" | "required" | "reason";

const REOPENED: readonly TicketStatus[] = ["closed", "invalid"];
// What a move asks of the officer's role beyond working the ticket.
export function moveCapability(from: TicketStatus, to: TicketStatus): DeskCapability {
  if (to === "forwarded") return "forwardTicket";
  return REOPENED.includes(from) ? "reopenTicket" : "moveTicket";
}

// The moves offered to this role from here.
export const offeredStatuses = (role: StaffRole, from: TicketStatus): TicketStatus[] =>
  NEXT_STATUSES[from].filter((to) => mayUse(role, moveCapability(from, to)));

const NEEDS_NOTE: readonly TicketStatus[] = ["in_handling", "closed"];

export function noteRule(from: TicketStatus, to: TicketStatus): NoteRule {
  if (to === "invalid") return "reason";
  return REOPENED.includes(from) || NEEDS_NOTE.includes(to) ? "required" : "optional";
}

function textError(fieldId: string, label: string, text: string, min: number): FieldError | null {
  const { max } = LENGTHS.staffText;
  if (text.length > max) return { fieldId, rule: "text.tooLong", params: { label, length: text.length, max } };
  if (text.length >= min) return null;
  return min > 1
    ? { fieldId, rule: "staffReason.tooShort", params: { min } }
    : { fieldId, rule: "required", params: { label } };
}

const NOTE_MIN: Readonly<Record<NoteRule, number>> = {
  optional: 0,
  required: 1,
  reason: LENGTHS.staffReason.min,
};

export type MoveCheck =
  | { readonly kind: "ok"; readonly note: string | null }
  | { readonly kind: "refused" }
  | { readonly kind: "invalid"; readonly error: FieldError };

export function checkMove(from: TicketStatus, to: TicketStatus, typed: string): MoveCheck {
  if (!NEXT_STATUSES[from].includes(to)) return { kind: "refused" };
  const note = typed.trim();
  const rule = noteRule(from, to);
  const error = textError("note", `desk.move.note.${rule}`, note, NOTE_MIN[rule]);
  if (error) return { kind: "invalid", error };
  return { kind: "ok", note: note === "" ? null : note };
}

export type ReplyCheck =
  | { readonly kind: "ok"; readonly text: string }
  | { readonly kind: "invalid"; readonly error: FieldError };

export function checkReply(typed: string): ReplyCheck {
  const text = typed.trim();
  const error = textError("reply", "desk.reply.label", text, 1);
  return error ? { kind: "invalid", error } : { kind: "ok", text };
}
