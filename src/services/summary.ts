import type { Card } from "../contract/card";
import { copy } from "../copy";
import { type ChronologyAnswers, chronologyText } from "../domain/chronology/sentence";
import type {
  ChronologyValue,
  EventTimeValue,
  FieldState,
  FieldStates,
  NeighbourhoodValue,
  OptionsValue,
  PlaceValue,
} from "../domain/fieldState";
import { applicableFields, chosenHazardType } from "../domain/fields/applicable";
import type { FieldDefinition, FieldId } from "../domain/fields/catalogue";
import type { HazardTypeId } from "../domain/hazards";

type SummaryGroup = Extract<Card, { kind: "summary" }>["groups"][number];
type RowValue = NonNullable<SummaryGroup["rows"][number]["value"]>;

export const phraseOf = (key: string) => copy.text(key);

type ChronologyRow = Extract<RowValue, { kind: "chronology" }>;

export function chronologyRow(
  hazardType: HazardTypeId,
  answers: ChronologyAnswers,
  note: string | null,
): ChronologyRow {
  return {
    kind: "chronology",
    hazardType,
    steps: answers.steps.map((optionIds, index) => ({
      step: index + 1,
      optionIds: [...optionIds],
      otherText: answers.otherText[index] ?? null,
    })),
    note,
    text: chronologyText(hazardType, answers, note, phraseOf),
  };
}

function rowValue(
  field: FieldDefinition,
  state: Extract<FieldState, { state: "value" }>,
  hazardType: HazardTypeId | null,
): RowValue {
  const value = state.value;
  switch (field.kind) {
    case "place": {
      const place = value as PlaceValue;
      return {
        kind: "place",
        villageName: place.villageName,
        districtName: place.districtName,
        regencyName: place.regencyName,
        provinceName: place.provinceName,
        precision: place.precision,
        point: place.point ?? null,
      };
    }
    case "neighbourhood":
      return { kind: "neighbourhood", ...(value as NeighbourhoodValue) };
    case "hazardType":
      return { kind: "hazardType", hazardType: value as HazardTypeId };
    case "hazardSubtype":
      return { kind: "hazardSubtype", hazardType: hazardType as HazardTypeId, subtype: value as string };
    case "chronology": {
      const chronology = value as ChronologyValue;
      return { ...chronologyRow(hazardType as HazardTypeId, chronology, chronology.note), text: chronology.text };
    }
    case "eventTime":
      return { kind: "eventTime", time: value as EventTimeValue };
    case "count":
      return { kind: "count", count: value as number };
    case "text":
      return { kind: "text", text: value as string };
    case "choice":
      return { kind: "options", optionIds: [value as string], otherText: null };
    default: {
      const options = value as OptionsValue;
      return { kind: "options", optionIds: [...options.optionIds], otherText: options.otherText };
    }
  }
}

export type SummaryRow = SummaryGroup["rows"][number];

// One field as the summary tells it, or null when it was never reached.
export function summaryRow(states: FieldStates, field: FieldDefinition): SummaryRow | null {
  const state = states[field.id as FieldId];
  if (state === undefined) return null;
  return {
    fieldId: field.id,
    state: state.state,
    value: state.state === "value" ? rowValue(field, state, chosenHazardType(states)) : null,
    origin: "origin" in state ? state.origin : null,
  };
}

// Every applicable field in table order, by group. A field never reached does not show.
export function summaryGroups(states: FieldStates): SummaryGroup[] {
  const groups: SummaryGroup[] = [];
  for (const field of applicableFields(states)) {
    const row = summaryRow(states, field);
    if (row === null) continue;
    let group = groups.at(-1);
    if (group?.groupId !== field.group) {
      group = { groupId: field.group, rows: [] };
      groups.push(group);
    }
    group.rows.push(row);
  }
  return groups;
}
