import type { ChronologyAnswers } from "../chronology/sentence";
import type { FieldStates, PlaceValue } from "../fieldState";
import type { FieldId, GroupId } from "../fields/catalogue";
import type { HazardTypeId } from "../hazards";

// A card shown over the question: the cancel confirm, or a group reopened from the summary.
type Overlay =
  | { readonly kind: "cancelConfirm" }
  | { readonly kind: "edit"; readonly groupId: GroupId; readonly done: readonly FieldId[] };

// A GPS reading waiting for the reporter to confirm it, with the villages nearest to it.
export type PlaceReading = {
  readonly village: PlaceValue;
  readonly nearby: readonly { readonly village: PlaceValue; readonly km: number }[];
  // "Bukan, pilih desa/kelurahan lain" was tapped: the nearby list shows.
  readonly showNearby: boolean;
};

// How the photo step ended: photos taken, or the reporter said they cannot send any.
type PhotosDone = "continued" | "cannotSend";

// Everything a draft holds while it is being filled. All of it is removed when the draft ends.
export type DraftContent = {
  readonly states: FieldStates;
  // Guided chronology answers while the steps are still being answered.
  readonly chronology: ChronologyAnswers | null;
  // Hazard types guessed from the reporter's words, shown first on the hazard card.
  readonly guesses: readonly HazardTypeId[];
  readonly overlay: Overlay | null;
  // A dangerous option was picked: its warning shows once under the next question.
  readonly danger: string | null;
  // Absent in drafts stored before the GPS and photo steps existed, read as null.
  readonly placeReading?: PlaceReading | null;
  readonly photosDone?: PhotosDone | null;
};

// How many times each field was answered while still empty. A second empty answer settles it.
export type AskedCounts = Readonly<Partial<Record<FieldId, number>>>;

export const EMPTY_CONTENT: DraftContent = { states: {}, chronology: null, guesses: [], overlay: null, danger: null };

export type Question =
  | { readonly kind: "place" }
  | { readonly kind: "placeConfirm" }
  | { readonly kind: "neighbourhood" }
  | { readonly kind: "choice"; readonly fieldId: FieldId }
  | { readonly kind: "multiChoice"; readonly fieldId: FieldId }
  | { readonly kind: "chronologyStep"; readonly step: number }
  | { readonly kind: "chronologyReview" }
  | { readonly kind: "eventTime" }
  | {
      readonly kind: "numberForm";
      readonly groupId: GroupId;
      readonly fieldIds: readonly FieldId[];
      readonly askedBefore: boolean;
    }
  | { readonly kind: "textQuestion"; readonly fieldId: FieldId; readonly askedBefore: boolean }
  | { readonly kind: "photos" }
  | { readonly kind: "summary" }
  | { readonly kind: "cancelConfirm" };

// The fields a question settles when it is answered.
export function questionFields(question: Question): readonly FieldId[] {
  switch (question.kind) {
    case "place":
    case "neighbourhood":
    case "eventTime":
      return [question.kind];
    case "placeConfirm":
      return ["place"];
    case "choice":
    case "multiChoice":
    case "textQuestion":
      return [question.fieldId];
    case "chronologyStep":
    case "chronologyReview":
      return ["chronology"];
    case "numberForm":
      return question.fieldIds;
    default:
      return [];
  }
}
