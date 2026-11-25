import { countOf, type FieldStates } from "./fieldState";
import type { FieldId } from "./fields/catalogue";

// Several counts told in one line. What is known, what is none and what is not known stay apart.
export type Tally = {
  readonly counts: readonly { readonly fieldId: FieldId; readonly count: number }[];
  readonly none: readonly FieldId[];
  readonly unknown: readonly FieldId[];
};

export function tallyOf(states: FieldStates, fieldIds: readonly FieldId[]): Tally {
  const counted = fieldIds.map((fieldId) => ({ fieldId, count: countOf(states[fieldId]) }));
  return {
    counts: counted.flatMap(({ fieldId, count }) => (count ? [{ fieldId, count }] : [])),
    none: counted.flatMap(({ fieldId, count }) => (count === 0 ? [fieldId] : [])),
    unknown: counted.flatMap(({ fieldId, count }) => (count === null ? [fieldId] : [])),
  };
}
