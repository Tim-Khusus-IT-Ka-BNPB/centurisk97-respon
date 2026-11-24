import type { FieldState, PlaceValue } from "../fieldState";
import { fieldsForHazard } from "../fields/applicable";
import type { FieldId } from "../fields/catalogue";
import type { HazardTypeId } from "../hazards";
import { maskText } from "../masking";
import { tidy } from "../text";
import { type AskedCounts, type DraftContent, type PlaceReading, type Question, questionFields } from "./content";
import {
  type AnswerContext,
  type Applied,
  answerChronologyReview,
  answerChronologyStep,
  answerEventTime,
  answerNumbers,
  answerText,
  type CardAnswer,
  invalid,
  STALE,
  withStates,
} from "./forms";
import { choiceOptions, isExclusiveOption } from "./options";

export type { AnswerContext, Applied, CardAnswer } from "./forms";

const applied = (content: DraftContent): Applied => ({ kind: "applied", content });
const NEIGHBOURHOOD_BOX = /^\d{1,3}$/;

function answerPlace(answer: CardAnswer, content: DraftContent, village: PlaceValue | null): Applied {
  if (answer.optionIds.length > 0) return STALE;
  if (village === null)
    return invalid({ fieldId: "villageCode", rule: "required", params: { label: "field.place.label" } });
  return applied(withStates(content, { place: { state: "value", value: village, origin: "tappedOption" } }));
}

// "Benar" takes the village read from GPS, "Bukan" opens the nearby list, and a village of that
// list replaces the read one while keeping the reading. Each is the reporter's tap on a read place.
function answerPlaceConfirm(answer: CardAnswer, content: DraftContent, village: PlaceValue | null): Applied {
  // The confirm card is asked only while a reading waits.
  const reading = content.placeReading as PlaceReading;
  const [option, ...rest] = answer.optionIds;
  if (rest.length > 0) return STALE;
  const placed = (value: PlaceValue) =>
    applied({
      ...withStates(content, { place: { state: "value", value, origin: "tappedOption" } }),
      placeReading: null,
    });
  if (village !== null && option === undefined) return reading.showNearby ? placed(village) : STALE;
  // "Benar" and "Bukan" are on screen only until the nearby list opens.
  if (reading.showNearby) return STALE;
  if (option === "confirm") return placed(reading.village);
  if (option === "other") return applied({ ...content, placeReading: { ...reading, showNearby: true } });
  return STALE;
}

// "Lanjut" needs a photo taken; "Tidak bisa mengirim foto" needs none.
function answerPhotos(answer: CardAnswer, content: DraftContent, photoCount: number): Applied {
  const [option, ...rest] = answer.optionIds;
  if (rest.length > 0) return STALE;
  if (option === "continue" && photoCount > 0) return applied({ ...content, photosDone: "continued" });
  if (option === "cannotSend" && photoCount === 0) return applied({ ...content, photosDone: "cannotSend" });
  return STALE;
}

function answerNeighbourhood(answer: CardAnswer, content: DraftContent): Applied {
  const [option, ...rest] = answer.optionIds;
  if (rest.length > 0 || (option !== undefined && option !== "unknown")) return STALE;
  const rt = tidy(answer.values.rt ?? "");
  const rw = tidy(answer.values.rw ?? "");
  if (option === "unknown" || (rt === "" && rw === ""))
    return applied(
      withStates(content, {
        neighbourhood: { state: "confirmedUnknown", origin: option ? "tappedOption" : "boxEntry" },
      }),
    );
  const errors = (
    [
      ["rt", rt],
      ["rw", rw],
    ] as const
  )
    .filter(([, value]) => value !== "" && !NEIGHBOURHOOD_BOX.test(value))
    .map(([fieldId]) => ({ fieldId, rule: "digits", params: { label: `field.neighbourhood.${fieldId}` } }));
  if (errors.length > 0) return invalid(...errors);
  const value = { rt: rt === "" ? null : rt, rw: rw === "" ? null : rw };
  return applied(withStates(content, { neighbourhood: { state: "value", value, origin: "boxEntry" } }));
}

// A changed hazard type makes its subtype and its guided chronology meaningless.
function chooseHazard(content: DraftContent, value: string): DraftContent {
  const previous = content.states.hazardType;
  const changed = previous?.state === "value" && previous.value !== value;
  const states = { ...content.states, hazardType: { state: "value", value, origin: "tappedOption" } as FieldState };
  if (changed) {
    delete states.hazardSubtype;
    delete states.chronology;
  }
  // Values told before the type was known stay only where the type asks for them.
  const kept = new Set(fieldsForHazard(value as HazardTypeId).map((field) => field.id));
  for (const fieldId of Object.keys(states) as FieldId[]) if (!kept.has(fieldId)) delete states[fieldId];
  return { ...content, states, chronology: changed ? null : content.chronology };
}

function answerChoice(
  fieldId: FieldId,
  answer: CardAnswer,
  content: DraftContent,
  multiple: boolean,
  context: AnswerContext,
): Applied {
  const offered = choiceOptions(fieldId, content.states);
  const picked = answer.optionIds.map((id) => offered.find((option) => option.id === id));
  if (picked.some((option) => option === undefined)) return STALE;
  const options = picked as NonNullable<(typeof picked)[number]>[];
  const label = `field.${fieldId}.label`;
  if (options.length === 0) return invalid({ fieldId, rule: "required", params: { label } });
  if (!multiple && options.length > 1) return STALE;
  const exclusive = options.find(isExclusiveOption);
  if (exclusive && options.length > 1)
    return invalid({
      fieldId,
      rule: "exclusiveWithOthers",
      params: { label, option: `option.${fieldId}.${exclusive.id}.label` },
    });
  if (fieldId === "hazardType") return applied(chooseHazard(content, (options[0] as { id: string }).id));
  let state: FieldState;
  if (exclusive?.meaning === "none") state = { state: "none", origin: "tappedOption" };
  else if (exclusive?.meaning === "unknown") state = { state: "confirmedUnknown", origin: "tappedOption" };
  else if (!multiple) state = { state: "value", value: (options[0] as { id: string }).id, origin: "tappedOption" };
  else {
    const other = options.find((option) => option.freeTextMaxLength !== undefined);
    let otherText: string | null = null;
    if (other) {
      const typed = tidy(answer.values.other ?? "");
      const max = other.freeTextMaxLength as number;
      const otherLabel = `option.${fieldId}.${other.id}.label`;
      if (typed === "") return invalid({ fieldId: "other", rule: "required", params: { label: otherLabel } });
      if (typed.length > max)
        return invalid({
          fieldId: "other",
          rule: "text.tooLong",
          params: { label: otherLabel, length: typed.length, max },
        });
      otherText = maskText(typed, context.reporter);
    }
    state = {
      state: "value",
      value: { optionIds: options.map((option) => option.id), otherText },
      origin: "tappedOption",
    };
  }
  return applied(withStates(content, { [fieldId]: state }));
}

function dispatch(
  question: Question,
  answer: CardAnswer,
  content: DraftContent,
  asked: AskedCounts,
  context: AnswerContext,
  village: PlaceValue | null,
): Applied {
  switch (question.kind) {
    case "place":
      return answerPlace(answer, content, village);
    case "placeConfirm":
      return answerPlaceConfirm(answer, content, village);
    case "photos":
      return answerPhotos(answer, content, context.photoCount);
    case "neighbourhood":
      return answerNeighbourhood(answer, content);
    case "choice":
      return answerChoice(question.fieldId, answer, content, false, context);
    case "multiChoice":
      return answerChoice(question.fieldId, answer, content, true, context);
    case "chronologyStep":
      return answerChronologyStep(question.step, answer, content, context);
    case "chronologyReview":
      return answerChronologyReview(answer, content, context);
    case "eventTime":
      return answerEventTime(answer, content, context);
    case "numberForm":
      return answerNumbers(question.fieldIds, answer, content, asked);
    case "textQuestion":
      return answerText(question.fieldId, answer, content, asked, context.reporter);
    default:
      return STALE;
  }
}

// Applies an answer to the card on screen. In a group reopened from the summary, the fields
// answered are marked done so the next card of the group follows.
export function applyAnswer(
  question: Question,
  answer: CardAnswer,
  content: DraftContent,
  asked: AskedCounts,
  context: AnswerContext,
  village: PlaceValue | null = null,
): Applied {
  const result = dispatch(question, answer, { ...content, danger: null }, asked, context, village);
  if (result.kind !== "applied") return result;
  const overlay = result.content.overlay;
  const finished = question.kind !== "chronologyStep";
  const next =
    overlay?.kind === "edit" && finished
      ? { ...result.content, overlay: { ...overlay, done: [...overlay.done, ...questionFields(question)] } }
      : result.content;
  return { kind: "applied", content: next, asked: result.asked ?? asked };
}
