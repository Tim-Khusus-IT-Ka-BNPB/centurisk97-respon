import { countOf, type FieldStates, isSettled } from "../fieldState";
import { type HazardTypeId, isHazardTypeId } from "../hazards";
import { FIELDS, type FieldDefinition, type FieldId } from "./catalogue";

// Fields that apply to a hazard type. A field tied to hazard types waits until the type is known.
export function fieldsForHazard(hazardType: HazardTypeId | null): readonly FieldDefinition[] {
  return FIELDS.filter((field: FieldDefinition) => {
    if (field.onlyFor && !field.onlyFor.some((id) => id === hazardType)) return false;
    return !field.exceptFor?.some((id) => id === hazardType);
  });
}

export function chosenHazardType(states: FieldStates): HazardTypeId | null {
  const state = states.hazardType;
  return state?.state === "value" && isHazardTypeId(state.value) ? state.value : null;
}

const parentAbove0 = (states: FieldStates) => (field: FieldDefinition) =>
  field.parent === undefined || (countOf(states[field.parent as FieldId]) ?? 0) > 0;

// Fields that apply to this draft: by hazard type, and a follow-up only when its parent count is above 0.
export function applicableFields(states: FieldStates): readonly FieldDefinition[] {
  return fieldsForHazard(chosenHazardType(states)).filter(parentAbove0(states));
}

// Fields a value told in words may be kept for: those of the chosen type, or of any type before
// it is chosen. A follow-up is kept even while its parent is not above 0; it shows once it is.
export function keepableFields(states: FieldStates): readonly FieldDefinition[] {
  const hazardType = chosenHazardType(states);
  return hazardType === null ? FIELDS : fieldsForHazard(hazardType);
}

// "Lengkap N persen": applicable fields holding a value, a none or a confirmed unknown, rounded.
export function completePercent(states: FieldStates): number {
  const applicable = applicableFields(states);
  const settled = applicable.filter((field) => isSettled(states[field.id as FieldId])).length;
  return Math.round((100 * settled) / applicable.length);
}
