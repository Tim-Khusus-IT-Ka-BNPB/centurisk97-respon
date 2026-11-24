import type { ErrorEnvelope } from "../../src/contract/errors";

export type FieldProblem = { readonly copyKey: string; readonly params: Readonly<Record<string, string | number>> };

// The refusal of one field, shown under it and tied to it.
export function problemOf(envelope: ErrorEnvelope | null, fieldId: string): FieldProblem | null {
  const found = envelope?.fields.find((field) => field.fieldId === fieldId);
  return found ? { copyKey: found.copyKey, params: found.params } : null;
}

// The first refused field in the order the form draws them, where focus goes.
export function firstInvalid(envelope: ErrorEnvelope | null, order: readonly string[]): string | null {
  return order.find((fieldId) => problemOf(envelope, fieldId) !== null) ?? null;
}

export const isLimit = (envelope: ErrorEnvelope | null) => envelope?.error.code.startsWith("limit.") === true;

// A card-level notice: anything that is neither a field refusal nor a limit (those draw elsewhere).
export function cardProblem(envelope: ErrorEnvelope | null): FieldProblem | null {
  if (envelope === null || isLimit(envelope)) return null;
  if (envelope.error.code === "request.invalidFields" && envelope.fields.length > 0) return null;
  return { copyKey: envelope.error.copyKey, params: envelope.error.params };
}

// The id an input's error line carries, for aria-describedby.
export const errorIdOf = (fieldId: string) => `${fieldId}-error`;
export const hintIdOf = (fieldId: string) => `${fieldId}-hint`;
