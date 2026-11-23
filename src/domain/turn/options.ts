import type { FieldStates } from "../fieldState";
import { chosenHazardType } from "../fields/applicable";
import { type FieldId, fieldById } from "../fields/catalogue";
import { applicableOptions, type ChoiceOption } from "../fields/options";
import { SELECTABLE_HAZARD_TYPES, subtypeChoices } from "../hazards";

const UNKNOWN_OPTION: ChoiceOption = { id: "unknown", meaning: "unknown" };

// The answers a choice question offers. Every choice card can be answered "Tidak tahu", so a list
// without such an answer gets one.
export function choiceOptions(fieldId: FieldId, states: FieldStates): readonly ChoiceOption[] {
  const hazardType = chosenHazardType(states);
  if (fieldId === "hazardType") return SELECTABLE_HAZARD_TYPES.map((id) => ({ id }));
  if (fieldId === "hazardSubtype") return subtypeChoices(hazardType ?? "other").map((id) => ({ id }));
  const field = fieldById(fieldId) as { options: readonly ChoiceOption[] };
  const options = applicableOptions(field.options, hazardType);
  if (!options.some((option) => option.meaning === "unknown")) return [...options, UNKNOWN_OPTION];
  return options;
}

// On a multiple choice question a none or an unknown cannot be picked with anything else.
export function isExclusiveOption(option: ChoiceOption): boolean {
  return option.meaning !== undefined;
}
