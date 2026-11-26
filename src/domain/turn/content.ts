import type { ChronologyAnswers } from "../chronology/sentence";
import type { VictimAnswer } from "../emergency";
import type { EventTimeValue, FieldStates, PlaceValue } from "../fieldState";
import type { FieldId, GroupId } from "../fields/catalogue";
import type { HazardTypeId } from "../hazards";
import { PHOTO } from "../photoChecks";

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

// News for a report already sent: what its newest version held when the follow-up was opened, and
// how many photos it may still add.
export type FollowUpOf = {
  readonly ticketNumber: string;
  readonly base: FieldStates;
  readonly photosLeft: number;
};

// A sent report of the same district the reporter may be telling of too (K66, D103 to D105): what
// is shown names no person, number or ticket.
export type SameEventOffer = {
  readonly ticketNumber: string;
  readonly hazardType: HazardTypeId;
  readonly hazardSubtype: string | null;
  readonly eventTime: EventTimeValue | null;
  // Since when it is known: its event time, or its send.
  readonly sinceMs: number;
  readonly reporters: number;
};

// Offered once, after the place: the report it joins, or none.
export type SameEvent = {
  readonly districtName: string;
  readonly offers: readonly SameEventOffer[];
  readonly answered: boolean;
  readonly joined: string | null;
};

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
  // An emergency report: whether anyone is hurt, missing or trapped, null until asked.
  readonly emergency?: { readonly victims: VictimAnswer | null } | null;
  readonly followUp?: FollowUpOf | null;
  // Absent until the place is known; null when no report nearby was offered.
  readonly sameEvent?: SameEvent | null;
};

// How many times each field was answered while still empty. A second empty answer settles it.
export type AskedCounts = Readonly<Partial<Record<FieldId, number>>>;

export const EMPTY_CONTENT: DraftContent = { states: {}, chronology: null, guesses: [], overlay: null, danger: null };

export const EMERGENCY_CONTENT: DraftContent = { ...EMPTY_CONTENT, emergency: { victims: null } };

// A follow-up starts on its review: what the report holds, and nothing new yet.
export const followUpContent = (followUp: FollowUpOf): DraftContent => ({
  ...EMPTY_CONTENT,
  states: followUp.base,
  photosDone: "continued",
  followUp,
});

// How many photos this draft may hold.
export const photoMax = (content: DraftContent): number => content.followUp?.photosLeft ?? PHOTO.maxPerDraft;

export type Question =
  | { readonly kind: "place" }
  | { readonly kind: "placeConfirm" }
  | { readonly kind: "neighbourhood" }
  | { readonly kind: "choice"; readonly fieldId: FieldId }
  | { readonly kind: "emergencyVictims" }
  | { readonly kind: "sameEvent" }
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
