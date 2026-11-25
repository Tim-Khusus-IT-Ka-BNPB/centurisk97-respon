import type { MeResponse } from "../../src/contract/draft";
import type { ErrorEnvelope } from "../../src/contract/errors";
import type { Texts } from "./text";

export type StartView =
  | "list"
  | "confirm"
  | "form"
  | "readBack"
  | "declineConfirm"
  | "declined"
  | "replaceConfirm"
  | "removeConfirm"
  | "discardConfirm";

export type StartPageData = {
  // Null when the numbers known on this device could not be read; the form still works.
  readonly me: MeResponse | null;
  readonly view: StartView;
  // The profile picked from the list, or being changed with "Ganti".
  readonly profileId: string | null;
  readonly editing: boolean;
  // The report being started is an emergency.
  readonly emergency: boolean;
  readonly texts: Texts;
};

export type IdentityValues = Readonly<
  Record<"role" | "name" | "number" | "officerRegency" | "officerPosition", string>
>;

export type StartActionData = {
  readonly view: StartView;
  readonly values: IdentityValues;
  readonly profileId: string | null;
  readonly editing: boolean;
  readonly readBack: string | null;
  readonly envelope: ErrorEnvelope | null;
  // The masked number just removed from this device, or the one whose removal failed.
  readonly removed: string | null;
  readonly removeFailed: string | null;
  // "Ganti" on the number read-back: the form comes back with focus on the number.
  readonly focusNumber: boolean;
};
