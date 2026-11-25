import { type CountBoxError, countOf, type FieldState, type FieldStates, readCountBox } from "./fieldState";
import { applicableFields, completePercent } from "./fields/applicable";
import type { FieldDefinition, FieldId } from "./fields/catalogue";
import type { FieldError } from "./identityForm";
import { LENGTHS } from "./limits";
import { textError } from "./ticketMoves";

// What an officer found on site (K69, D108 to D110). The figures may be put right; what happened,
// where and when are the reporter's alone. Nothing the reporter gave is overwritten: a correction
// makes a new version of the report's values.

export const CHECK_RESULTS = ["valid", "partly", "notValid"] as const;
export type CheckResult = (typeof CHECK_RESULTS)[number];

export const REVISABLE = [
  "dead",
  "missing",
  "injured",
  "displacedPeople",
  "housesHeavy",
  "housesModerate",
  "housesLight",
  "housesFlooded",
  "schools",
  "healthFacilities",
  "worshipPlaces",
  "roads",
] as const satisfies readonly FieldId[];

type RevisableId = (typeof REVISABLE)[number];
type CountField = Extract<FieldDefinition, { kind: "count" }> & { readonly id: RevisableId };

const isRevisable = (field: FieldDefinition): field is CountField => REVISABLE.some((id) => id === field.id);

// The figures of this report an officer may put right, each with the value it holds: 0 for an
// explicit none, null when not known.
export const revisableOf = (states: FieldStates) =>
  applicableFields(states)
    .filter(isRevisable)
    .map(({ id, unit, max }) => ({ fieldId: id, unit, max, count: countOf(states[id]) }));

export type Change = { readonly fieldId: RevisableId; readonly from: number | null; readonly to: number };

export type FieldCheck =
  | { readonly kind: "ok"; readonly note: string; readonly changes: readonly Change[] }
  | { readonly kind: "invalid"; readonly error: FieldError };

const RULE: Readonly<Record<CountBoxError, string>> = {
  countNeeded: "countNeeded",
  wholeNumber: "wholeNumber",
  tooLarge: "tooLarge",
};

// The boxes hold the values the page showed: an empty one, or one left as it was, changes nothing.
export function checkFieldCheck(
  states: FieldStates,
  result: CheckResult,
  typedNote: string,
  boxes: Readonly<Record<string, string | undefined>>,
): FieldCheck {
  const changes: Change[] = [];
  for (const { fieldId, max, count } of revisableOf(states)) {
    const box = readCountBox(boxes[fieldId] ?? "", max);
    if (box.kind === "error")
      return {
        kind: "invalid",
        error: { fieldId, rule: RULE[box.rule], params: { label: `field.${fieldId}.label`, max } },
      };
    if (box.kind === "count" && box.count !== count) changes.push({ fieldId, from: count, to: box.count });
  }
  if (result !== "partly" && changes.length > 0)
    return { kind: "invalid", error: { fieldId: "result", rule: `check.${result}WithChanges`, params: {} } };
  const note = typedNote.trim();
  const error = textError("checkNote", "desk.check.note", note, LENGTHS.staffReason.min);
  return error ? { kind: "invalid", error } : { kind: "ok", note, changes };
}

// The report's values with the officer's corrections, each with the note that came with it. A 0 is
// an explicit none.
export function revised(
  states: FieldStates,
  changes: readonly Change[],
  note: string,
): { readonly states: FieldStates; readonly completePercent: number } {
  const next: FieldStates = { ...states };
  for (const { fieldId, to } of changes) {
    const source = { origin: "officer", quote: note } as const;
    next[fieldId] = (
      to === 0 ? { state: "none", ...source } : { state: "value", value: to, ...source }
    ) satisfies FieldState;
  }
  return { states: next, completePercent: completePercent(next) };
}
