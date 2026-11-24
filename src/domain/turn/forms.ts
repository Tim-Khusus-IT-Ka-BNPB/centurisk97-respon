import { type ChronologyStep, chronologySteps, isExclusive } from "../chronology";
import { chronologyText, type PhraseOf } from "../chronology/sentence";
import { checkEventTime, localDate, type Zone } from "../eventTime";
import { countState, type EventTimeValue, type FieldState, readCountBox } from "../fieldState";
import { chosenHazardType } from "../fields/applicable";
import { type FieldId, fieldById } from "../fields/catalogue";
import type { HazardTypeId } from "../hazards";
import type { FieldError } from "../identityForm";
import { LENGTHS } from "../limits";
import { type MaskedText, maskText, type Reporter } from "../masking";
import { tidy } from "../text";
import { DAY_MS } from "../time";
import type { AskedCounts, DraftContent } from "./content";
import { MAX_ASKS } from "./next";

export type CardAnswer = {
  readonly optionIds: readonly string[];
  readonly values: Readonly<Record<string, string>>;
};

export type AnswerContext = {
  readonly nowMs: number;
  readonly zone: Zone;
  readonly reporter: Reporter;
  readonly phraseOf: PhraseOf;
  // Photos already taken in this draft, which the photo step's two endings depend on.
  readonly photoCount: number;
};

export type Applied =
  | { readonly kind: "applied"; readonly content: DraftContent; readonly asked?: AskedCounts }
  | { readonly kind: "invalid"; readonly errors: readonly FieldError[] }
  // The answer does not fit the card on screen: the tab is behind.
  | { readonly kind: "stale" };

export const invalid = (...errors: FieldError[]): Applied => ({ kind: "invalid", errors });
export const STALE: Applied = { kind: "stale" };
const labelOf = (fieldId: string) => `field.${fieldId}.label`;

export function withStates(content: DraftContent, states: Partial<Record<FieldId, FieldState>>): DraftContent {
  return { ...content, states: { ...content.states, ...states } };
}

const UNKNOWN_WORDS = /^(?:belum tahu|tidak tahu|tidak diketahui|belum diketahui)$/i;
const NONE_WORDS = /^(?:tidak ada|nihil|nol)$/i;

// An empty answer: "belum didata" the first time, settled the second time.
function emptyAnswer(fieldId: FieldId, asked: AskedCounts, settle: FieldState | null) {
  const times = (asked[fieldId] ?? 0) + 1;
  const state: FieldState = times >= MAX_ASKS && settle ? settle : { state: "notYetKnown" };
  return { state, times };
}

// A box filled from the reporter's words keeps its value when a form button settles the rest.
const keepsValue = (state: FieldState | undefined) => state?.state === "value" || state?.state === "none";

// One number form: a 0 is a none, an empty box is not yet known, asked once more, then not known.
export function answerNumbers(
  fieldIds: readonly FieldId[],
  answer: CardAnswer,
  content: DraftContent,
  asked: AskedCounts,
): Applied {
  const action = answer.optionIds[0];
  if (answer.optionIds.length > 1 || (action !== undefined && action !== "allNone" && action !== "allUnknown"))
    return STALE;
  const states: Partial<Record<FieldId, FieldState>> = {};
  const counts: Partial<Record<FieldId, number>> = { ...asked };
  const errors: FieldError[] = [];
  for (const fieldId of fieldIds) {
    const { max } = fieldById(fieldId) as { max: number };
    const typed = tidy(answer.values[fieldId] ?? "");
    const box = readCountBox(typed, max);
    if (UNKNOWN_WORDS.test(typed)) states[fieldId] = { state: "confirmedUnknown", origin: "boxEntry" };
    else if (NONE_WORDS.test(typed)) states[fieldId] = { state: "none", origin: "boxEntry" };
    else if (box.kind === "error") errors.push({ fieldId, rule: box.rule, params: { label: labelOf(fieldId), max } });
    else if (box.kind === "count") states[fieldId] = countState(box.count, "boxEntry");
    else if (action !== undefined && keepsValue(content.states[fieldId])) continue;
    else if (action === "allNone") states[fieldId] = { state: "none", origin: "tappedOption" };
    else if (action === "allUnknown") states[fieldId] = { state: "confirmedUnknown", origin: "tappedOption" };
    else {
      const empty = emptyAnswer(fieldId, asked, { state: "confirmedUnknown", origin: "boxEntry" });
      states[fieldId] = empty.state;
      counts[fieldId] = empty.times;
    }
  }
  if (errors.length > 0) return invalid(...errors);
  return { kind: "applied", content: withStates(content, states), asked: counts };
}

// A typed answer to one text question. Unanswered twice it stays "belum didata".
export function answerText(
  fieldId: FieldId,
  answer: CardAnswer,
  content: DraftContent,
  asked: AskedCounts,
  reporter: Reporter,
): Applied {
  const [option, ...rest] = answer.optionIds;
  if (rest.length > 0 || (option !== undefined && option !== "unknown")) return STALE;
  if (option === "unknown")
    return {
      kind: "applied",
      content: withStates(content, { [fieldId]: { state: "confirmedUnknown", origin: "tappedOption" } }),
    };
  const { maxLength: max } = fieldById(fieldId) as { maxLength: number };
  const text = tidy(answer.values[fieldId] ?? "");
  if (text.length > max)
    return invalid({ fieldId, rule: "text.tooLong", params: { label: labelOf(fieldId), length: text.length, max } });
  if (UNKNOWN_WORDS.test(text))
    return {
      kind: "applied",
      content: withStates(content, { [fieldId]: { state: "confirmedUnknown", origin: "boxEntry" } }),
      asked,
    };
  if (NONE_WORDS.test(text))
    return {
      kind: "applied",
      content: withStates(content, { [fieldId]: { state: "none", origin: "boxEntry" } }),
      asked,
    };
  if (text === "") {
    const empty = emptyAnswer(fieldId, asked, null);
    return {
      kind: "applied",
      content: withStates(content, { [fieldId]: empty.state }),
      asked: { ...asked, [fieldId]: empty.times },
    };
  }
  const value: MaskedText = maskText(text, reporter);
  return {
    kind: "applied",
    content: withStates(content, { [fieldId]: { state: "value", value, origin: "boxEntry" } }),
    asked,
  };
}

const HOUR = /^(\d{1,2})[.:](\d{2})$/;
const TIME_OPTIONS = new Set(["today", "yesterday", "otherDate", "hourUnknown", "olderThan30Days"]);

function typedHour(raw: string): string | null | "invalid" {
  const text = raw.trim();
  if (text === "") return null;
  const match = HOUR.exec(text);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return "invalid";
  return `${(match[1] as string).padStart(2, "0")}:${match[2]}`;
}

// The event time card. The date is required, the hour optional and never guessed. Values of
// inputs hidden for the answer picked are ignored, as a form with no script still sends them.
export function answerEventTime(answer: CardAnswer, content: DraftContent, context: AnswerContext): Applied {
  const picked = new Set(answer.optionIds);
  if ([...picked].some((id) => !TIME_OPTIONS.has(id))) return STALE;
  const dateError = (rule: string) =>
    invalid({ fieldId: "date", rule: `time.${rule}`, params: { label: "card.timeCard.date" } });
  let value: EventTimeValue;
  let origin: "tappedOption" | "boxEntry" = "tappedOption";
  if (picked.has("olderThan30Days")) value = { kind: "olderThan30Days" };
  else {
    let date: string;
    if (picked.has("today")) date = localDate(context.nowMs, context.zone);
    else if (picked.has("yesterday")) date = localDate(context.nowMs - DAY_MS, context.zone);
    else if (picked.has("otherDate")) {
      // An empty or unreadable date is refused below as a date not given.
      date = String(answer.values.date).trim();
      origin = "boxEntry";
    } else return dateError("dateRequired");
    const hour = picked.has("hourUnknown") ? null : typedHour(answer.values.hour ?? "");
    if (hour === "invalid")
      return invalid({ fieldId: "hour", rule: "time.hourFormat", params: { label: "card.timeCard.hour" } });
    if (hour !== null) origin = "boxEntry";
    value =
      hour === null
        ? { kind: "dateOnly", localDate: date, zone: context.zone }
        : { kind: "dateTime", localDate: date, localTime: hour, zone: context.zone };
    const error = checkEventTime(value, context.nowMs);
    if (error) return dateError(error === "dateFormat" ? "dateRequired" : error);
  }
  return { kind: "applied", content: withStates(content, { eventTime: { state: "value", value, origin } }) };
}

// One step of the guided chronology. A typed "Lainnya" is masked and limited like the note.
export function answerChronologyStep(
  step: number,
  answer: CardAnswer,
  content: DraftContent,
  context: AnswerContext,
): Applied {
  const hazardType = chosenHazardType(content.states) as HazardTypeId;
  const definition = chronologySteps(hazardType)[step] as ChronologyStep;
  const base = `chronology.${hazardType}.step${step + 1}`;
  const options = answer.optionIds.map((id) => definition.options.find((option) => option.id === id));
  if (options.some((option) => option === undefined)) return STALE;
  const picked = options as NonNullable<(typeof options)[number]>[];
  const label = `${base}.question`;
  if (picked.length === 0) return invalid({ fieldId: "options", rule: "required", params: { label } });
  if (!definition.multiple && picked.length > 1) return STALE;
  const exclusive = picked.find((option) => isExclusive(definition, option));
  if (exclusive && picked.length > 1)
    return invalid({
      fieldId: "options",
      rule: "exclusiveWithOthers",
      params: { label, option: `${base}.option.${exclusive.id}.label` },
    });
  const otherText = { ...(content.chronology?.otherText ?? {}) };
  if (picked.some((option) => option.freeText)) {
    const typed = tidy(answer.values.other ?? "");
    const max = LENGTHS.chronologyNote.max;
    if (typed === "")
      return invalid({ fieldId: "other", rule: "required", params: { label: `${base}.option.other.label` } });
    if (typed.length > max)
      return invalid({
        fieldId: "other",
        rule: "text.tooLong",
        params: { label: `${base}.option.other.label`, length: typed.length, max },
      });
    otherText[step] = maskText(typed, context.reporter);
  }
  const steps = [...(content.chronology?.steps ?? []), picked.map((option) => option.id)];
  const danger = definition.warning && picked.some((option) => option.danger) ? `${base}.warning` : null;
  return { kind: "applied", content: { ...content, chronology: { steps, otherText }, danger } };
}

// "Kronologi tersusun": the note is optional; note and whole text have their own limits.
export function answerChronologyReview(answer: CardAnswer, content: DraftContent, context: AnswerContext): Applied {
  const [option, ...rest] = answer.optionIds;
  if (rest.length > 0 || (option !== undefined && option !== "done" && option !== "add")) return STALE;
  const hazardType = chosenHazardType(content.states) as HazardTypeId;
  const answers = content.chronology ?? { steps: [], otherText: {} };
  // "Tidak ada, lanjut" sends no note, whatever the hidden box holds.
  const typed = option === "done" ? "" : tidy(answer.values.note ?? "");
  const note = typed === "" ? null : maskText(typed, context.reporter);
  const label = "field.chronology.label";
  if (typed.length > LENGTHS.chronologyNote.max)
    return invalid({
      fieldId: "note",
      rule: "text.tooLong",
      params: { label, length: typed.length, max: LENGTHS.chronologyNote.max },
    });
  const text = chronologyText(hazardType, answers, note, context.phraseOf);
  if (text.length > LENGTHS.chronologyWhole.max)
    return invalid({
      fieldId: "note",
      rule: "text.tooLong",
      params: { label, length: text.length, max: LENGTHS.chronologyWhole.max },
    });
  const value = { steps: answers.steps, otherText: answers.otherText, note, text };
  return {
    kind: "applied",
    content: {
      ...withStates(content, { chronology: { state: "value", value, origin: "tappedOption" } }),
      chronology: null,
    },
  };
}
