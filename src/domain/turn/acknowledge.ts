import type { FieldState, FieldStates, OptionsValue } from "../fieldState";
import { chosenHazardType } from "../fields/applicable";
import { FIELDS, type FieldId } from "../fields/catalogue";
import type { HazardTypeId } from "../hazards";
import type { Question } from "./content";

// What Sigap says back after a story: each value it read from the reporter's words and kept, so the
// reporter sees what was understood and can correct it. A none is null; a choice is its option id,
// several are a list; a count is its number; a text is the reporter's words.
export type NotedFact = {
  readonly field: FieldId;
  readonly value: number | string | readonly string[] | null;
};

function factValue(state: FieldState): NotedFact["value"] | undefined {
  if (state.state === "none") return null;
  if (state.state !== "value") return undefined;
  const { value } = state;
  if (typeof value === "number" || typeof value === "string") return value;
  return (value as OptionsValue).optionIds;
}

// The values this turn read from the reporter's words: new or changed, in the catalogue's order.
export function notedFacts(before: FieldStates, after: FieldStates): readonly NotedFact[] {
  const facts: NotedFact[] = [];
  for (const { id } of FIELDS) {
    const state = after[id as FieldId];
    if (state === undefined || !("origin" in state) || state.origin !== "quote") continue;
    if (JSON.stringify(before[id as FieldId]) === JSON.stringify(state)) continue;
    const value = factValue(state);
    if (value !== undefined) facts.push({ field: id as FieldId, value });
  }
  return facts;
}

// The hazard type this turn chose, when none was chosen before: its safety line is said once.
export function newlyChosenHazard(before: FieldStates, after: FieldStates): HazardTypeId | null {
  return chosenHazardType(before) === null ? chosenHazardType(after) : null;
}

const HAS_LETTERS = /\p{L}/u;

// Words the reporter typed on a card, which a reader of another language needs in Indonesian: a text
// answer, an "other" answer, or a chronology note. Numbers, dates and RT RW are not words.
export function typedWords(question: Question, values: Readonly<Record<string, string>>): string | null {
  const typed =
    question.kind === "textQuestion"
      ? values[question.fieldId]
      : question.kind === "multiChoice" || question.kind === "chronologyStep"
        ? values.other
        : question.kind === "chronologyReview"
          ? values.note
          : undefined;
  const text = typed?.trim() ?? "";
  return HAS_LETTERS.test(text) ? text : null;
}

// A text answer typed on a card keeps how it reads in Indonesian, as a value read from words does.
export function withTranslation(states: FieldStates, fieldId: FieldId, translation: string): FieldStates {
  const state = states[fieldId];
  if (state?.state !== "value" || typeof state.value !== "string") return states;
  return { ...states, [fieldId]: { ...state, translation } };
}
