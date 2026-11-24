import type { Zone } from "./eventTime";
import type { FieldId } from "./fields/catalogue";

export type EventTimeValue =
  | { readonly kind: "dateTime"; readonly localDate: string; readonly localTime: string; readonly zone: Zone }
  | { readonly kind: "dateOnly"; readonly localDate: string; readonly zone: Zone }
  | { readonly kind: "olderThan30Days" };

// Names are kept with the code so the summary and the sent version read the same snapshot.
// How the place is known: a village picked by search, or a GPS reading (D10).
type PlacePrecision = "villageLevel" | "gpsPoint" | "estimate";

// The device's reading when the place came from GPS. Coordinates are kept as read.
export type PlacePoint = { readonly lat: number; readonly lon: number; readonly accuracyM: number };

export type PlaceValue = {
  readonly villageCode: string;
  readonly precision: PlacePrecision;
  readonly point?: PlacePoint;
  readonly snapshotId: number;
  readonly villageName: string;
  readonly districtName: string;
  readonly regencyName: string;
  readonly provinceName: string;
};

export type NeighbourhoodValue = { readonly rt: string | null; readonly rw: string | null };

export type ChronologyValue = {
  // Option ids picked at each step, in step order; a typed "Lainnya" answer is kept in otherText.
  readonly steps: readonly (readonly string[])[];
  readonly otherText: Readonly<Record<number, string>>;
  readonly note: string | null;
  // The joined sentences, as stored in the report.
  readonly text: string;
};

// Options picked on a choice question; "Lainnya" carries the reporter's own words.
export type OptionsValue = { readonly optionIds: readonly string[]; readonly otherText: string | null };

type FieldValue = number | string | OptionsValue | EventTimeValue | PlaceValue | NeighbourhoodValue | ChronologyValue;

// Where a value came from. A quote is the reporter's own masked words and is required for that origin.
type Sourced =
  | { readonly origin: "boxEntry" | "tappedOption" | "system" }
  | { readonly origin: "quote"; readonly quote: string };

// An absent entry is "notAsked". "none" is the only state that stands for zero.
export type FieldState =
  | ({ readonly state: "value"; readonly value: FieldValue } & Sourced)
  | ({ readonly state: "none" } & Sourced)
  | { readonly state: "notYetKnown" }
  | ({ readonly state: "confirmedUnknown" } & Sourced);

export type FieldStates = Partial<Record<FieldId, FieldState>>;

export type CountBox = { readonly kind: "empty" } | { readonly kind: "count"; readonly count: number };
export type CountBoxError = "countNeeded" | "wholeNumber" | "tooLarge";

const WHOLE_NUMBER = /^\d+$/;
const PRESENCE_WITHOUT_COUNT = /^ada$/i;

// Reads one number box. A 0 is an explicit none; an empty box is not a zero.
export function readCountBox(
  raw: string,
  max: number,
): CountBox | { readonly kind: "error"; readonly rule: CountBoxError } {
  const text = raw.trim();
  if (text === "") return { kind: "empty" };
  if (PRESENCE_WITHOUT_COUNT.test(text)) return { kind: "error", rule: "countNeeded" };
  if (!WHOLE_NUMBER.test(text)) return { kind: "error", rule: "wholeNumber" };
  const count = Number(text);
  if (count > max) return { kind: "error", rule: "tooLarge" };
  return { kind: "count", count };
}

export function countState(count: number, origin: "boxEntry"): FieldState;
export function countState(count: number, origin: "quote", quote: string): FieldState;
export function countState(count: number, origin: "boxEntry" | "quote", quote?: string): FieldState {
  const source: Sourced = origin === "quote" ? { origin, quote: quote as string } : { origin };
  return count === 0 ? { state: "none", ...source } : { state: "value", value: count, ...source };
}

// The count a field stands for: its number, 0 for an explicit none, null when not known.
export function countOf(state: FieldState | undefined): number | null {
  if (state?.state === "none") return 0;
  if (state?.state === "value" && typeof state.value === "number") return state.value;
  return null;
}

// Answered for completeness: a value, a none, or a confirmed "tidak tahu".
export function isSettled(state: FieldState | undefined): boolean {
  return state !== undefined && state.state !== "notYetKnown";
}
