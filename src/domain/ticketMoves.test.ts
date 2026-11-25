import { describe, expect, test } from "vitest";
import type { TicketStatus } from "./stages";
import { checkMove, checkReply, NEXT_STATUSES, noteRule } from "./ticketMoves";

const ALL: readonly TicketStatus[] = ["new", "seen", "under_review", "forwarded", "in_handling", "closed", "invalid"];

const ALLOWED: Readonly<Record<TicketStatus, readonly TicketStatus[]>> = {
  new: [],
  seen: ["under_review", "invalid"],
  under_review: ["forwarded", "in_handling", "invalid"],
  forwarded: ["in_handling", "invalid"],
  in_handling: ["closed", "invalid"],
  closed: ["under_review"],
  invalid: ["under_review"],
};

const pairs = ALL.flatMap((from) => ALL.map((to) => [from, to] as const));
const NOTE = "Dicek ke BPBD";

describe("where a ticket may go", () => {
  test("as the table says, and nowhere else", () => {
    expect(NEXT_STATUSES).toEqual(ALLOWED);
  });

  test.each(pairs)("%s to %s is offered and accepted only when the table allows it", (from, to) => {
    const allowed = ALLOWED[from].includes(to);
    expect(NEXT_STATUSES[from].includes(to)).toBe(allowed);
    expect(checkMove(from, to, NOTE)).toEqual(allowed ? { kind: "ok", note: NOTE } : { kind: "refused" });
  });

  test.each([
    ["seen", "under_review", "optional"],
    ["under_review", "forwarded", "optional"],
    ["under_review", "in_handling", "required"],
    ["in_handling", "closed", "required"],
    ["closed", "under_review", "required"],
    ["invalid", "under_review", "required"],
    ["seen", "invalid", "reason"],
    ["in_handling", "invalid", "reason"],
  ] as const)("%s to %s needs a note that is %s", (from, to, rule) => {
    expect(noteRule(from, to)).toBe(rule);
  });
});

describe("the note", () => {
  test("is trimmed, and an empty one that may be left out is none", () => {
    expect(checkMove("seen", "under_review", "  Dicek  ")).toEqual({ kind: "ok", note: "Dicek" });
    expect(checkMove("seen", "under_review", "   ")).toEqual({ kind: "ok", note: null });
  });

  test("is asked for where it is required", () => {
    expect(checkMove("closed", "under_review", "  ")).toEqual({
      kind: "invalid",
      error: { fieldId: "note", rule: "required", params: { label: "desk.move.note.required" } },
    });
    expect(checkMove("closed", "under_review", "x")).toEqual({ kind: "ok", note: "x" });
  });

  test("a reason for the reporter has 5 characters or more", () => {
    expect(checkMove("seen", "invalid", "dup")).toEqual({
      kind: "invalid",
      error: { fieldId: "note", rule: "staffReason.tooShort", params: { min: 5 } },
    });
    expect(checkMove("seen", "invalid", " dupl ")).toMatchObject({ kind: "invalid" });
    expect(checkMove("seen", "invalid", "duplo")).toEqual({ kind: "ok", note: "duplo" });
  });

  test("has 1,000 characters at most", () => {
    expect(checkMove("seen", "under_review", "a".repeat(1000))).toMatchObject({ kind: "ok" });
    expect(checkMove("seen", "under_review", "a".repeat(1001))).toEqual({
      kind: "invalid",
      error: {
        fieldId: "note",
        rule: "text.tooLong",
        params: { label: "desk.move.note.optional", length: 1001, max: 1000 },
      },
    });
  });
});

describe("a reply", () => {
  test("is trimmed, not empty, and has 1,000 characters at most", () => {
    expect(checkReply(" Terima kasih ")).toEqual({ kind: "ok", text: "Terima kasih" });
    expect(checkReply("a")).toEqual({ kind: "ok", text: "a" });
    expect(checkReply("  ")).toEqual({
      kind: "invalid",
      error: { fieldId: "reply", rule: "required", params: { label: "desk.reply.label" } },
    });
    expect(checkReply("a".repeat(1001))).toEqual({
      kind: "invalid",
      error: { fieldId: "reply", rule: "text.tooLong", params: { label: "desk.reply.label", length: 1001, max: 1000 } },
    });
  });
});
