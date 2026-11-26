import { chronologySteps } from "../chronology";
import type { DraftState } from "../draftStates";
import type { VictimAnswer } from "../emergency";
import type { FieldState } from "../fieldState";
import { applicableFields, chosenHazardType } from "../fields/applicable";
import type { FieldDefinition, FieldId } from "../fields/catalogue";
import { isLocked, openedBy } from "../followUp";
import type { HazardTypeId } from "../hazards";
import type { AskedCounts, DraftContent, FollowUpOf, Question } from "./content";

// Second empty answer settles a field, so a field is asked again at most once.
export const MAX_ASKS = 2;

const isAsked = (field: FieldDefinition) => field.kind !== "place" && field.kind !== "neighbourhood";

function questionFor(
  field: FieldDefinition,
  candidates: readonly FieldDefinition[],
  content: DraftContent,
  askedBefore: boolean,
): Question {
  const id = field.id as FieldId;
  switch (field.kind) {
    case "hazardType":
    case "hazardSubtype":
    case "choice":
      return { kind: "choice", fieldId: id };
    case "multiChoice":
      return { kind: "multiChoice", fieldId: id };
    case "eventTime":
      return { kind: "eventTime" };
    case "text":
      return { kind: "textQuestion", fieldId: id, askedBefore };
    case "chronology": {
      const total = chronologySteps(chosenHazardType(content.states) as HazardTypeId).length;
      const answered = content.chronology?.steps.length ?? 0;
      return answered < total ? { kind: "chronologyStep", step: answered } : { kind: "chronologyReview" };
    }
    default: {
      // A follow-up count is asked alone; the other counts of a group share one form.
      const fieldIds = field.parent
        ? [id]
        : candidates
            .filter((other) => other.group === field.group && !other.parent)
            .map((other) => other.id as FieldId);
      return { kind: "numberForm", groupId: field.group, fieldIds, askedBefore };
    }
  }
}

// An emergency asks only what happened and whether anyone is hurt, then for photos (K68).
function emergencyQuestion(content: DraftContent, victims: VictimAnswer | null): Question {
  const { overlay } = content;
  const reopened = overlay?.kind === "edit" && !overlay.done.includes("hazardType");
  if (reopened || content.states.hazardType === undefined) return { kind: "choice", fieldId: "hazardType" };
  if (victims === null) return { kind: "emergencyVictims" };
  return content.photosDone ? { kind: "summary" } : { kind: "photos" };
}

// News for a sent report asks only the group picked and what the news opens; what the report is
// about is never asked again.
function followUpQuestion(content: DraftContent, { base }: FollowUpOf): Question {
  const { overlay, states } = content;
  const fields = applicableFields(states).filter((field) => !isLocked(base, field.id as FieldId));
  if (overlay?.kind === "edit") {
    const open = fields.filter(
      (field) => field.group === overlay.groupId && !overlay.done.includes(field.id as FieldId),
    );
    if (open[0]) return questionFor(open[0], open, content, false);
  }
  const ids = openedBy(base, states);
  const opened = fields.filter((field) => ids.includes(field.id as FieldId));
  if (opened[0]) return questionFor(opened[0], opened, content, false);
  return content.photosDone ? { kind: "summary" } : { kind: "photos" };
}

// What the reporter is asked next. Code decides this from the field table alone: first every
// applicable field never asked, in table order, then each field left empty once more, then the summary.
export function nextQuestion(_state: DraftState, content: DraftContent, asked: AskedCounts): Question {
  if (content.overlay?.kind === "cancelConfirm") return { kind: "cancelConfirm" };
  if (content.followUp) return followUpQuestion(content, content.followUp);
  if (content.states.place === undefined) return content.placeReading ? { kind: "placeConfirm" } : { kind: "place" };
  if (content.emergency) return emergencyQuestion(content, content.emergency.victims);
  if (content.states.neighbourhood === undefined) return { kind: "neighbourhood" };
  if (content.sameEvent && !content.sameEvent.answered) return { kind: "sameEvent" };
  const fields = applicableFields(content.states).filter(isAsked);
  const unasked = fields.filter((field) => content.states[field.id as FieldId] === undefined);
  if (content.overlay?.kind === "edit") {
    const { groupId, done } = content.overlay;
    const open = fields.filter((field) => field.group === groupId && !done.includes(field.id as FieldId));
    if (open[0]) return questionFor(open[0], open, content, false);
    // After "Ubah" the reporter returns to the summary, unless the change opened a new field.
    return unasked[0] ? questionFor(unasked[0], unasked, content, false) : { kind: "summary" };
  }
  if (unasked[0]) return questionFor(unasked[0], unasked, content, false);
  const again = fields.filter(
    (field) =>
      (content.states[field.id as FieldId] as FieldState).state === "notYetKnown" &&
      (asked[field.id as FieldId] ?? 0) < MAX_ASKS,
  );
  if (again[0]) return questionFor(again[0], again, content, true);
  return content.photosDone ? { kind: "summary" } : { kind: "photos" };
}

// The stored state a question belongs to.
export function stateFor(question: Question, current: DraftState): DraftState {
  if (question.kind === "place" || question.kind === "neighbourhood" || question.kind === "photos")
    return question.kind;
  if (question.kind === "placeConfirm") return "place_confirm";
  if (question.kind === "cancelConfirm") return current;
  if (question.kind === "chronologyStep" || question.kind === "chronologyReview") return "guided_chronology";
  return question.kind === "summary" ? "summary" : "asking";
}
