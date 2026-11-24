import { type FieldDefinition, type FieldId, fieldById } from "../../src/domain/fields/catalogue";

// The unit a count or a measured choice is given in ("orang", "rumah", "cm"), as a copy key.
export function unitKeyOf(fieldId: string): string | null {
  const field = fieldById(fieldId as FieldId) as FieldDefinition | undefined;
  return field !== undefined && "unit" in field && field.unit !== undefined ? `unit.${field.unit}` : null;
}
