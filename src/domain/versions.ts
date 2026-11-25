import type { FieldState, FieldStates } from "./fieldState";
import { FIELDS, type FieldId } from "./fields/catalogue";

// A report's versions are its values at each time it was sent or put right. What tells two apart
// is what a value says, never where it came from.

// What a field says: nothing known reads the same however it came to be so.
function told(state: FieldState | undefined): string {
  if (state?.state === "none") return "none";
  if (state?.state !== "value") return "";
  // A chronology is its sentences; how it was answered is not shown.
  const value = state.value as number | string | { readonly text?: string };
  return JSON.stringify(typeof value === "object" && value.text !== undefined ? value.text : value);
}

export type VersionChange = {
  readonly fieldId: FieldId;
  readonly from: FieldState | undefined;
  readonly to: FieldState | undefined;
};

// The values that say something else in the later version, in the order they are asked.
export function versionChanges(before: FieldStates, after: FieldStates): VersionChange[] {
  return FIELDS.flatMap(({ id }) =>
    told(before[id]) === told(after[id]) ? [] : [{ fieldId: id, from: before[id], to: after[id] }],
  );
}
