// States of a stored draft and the moves the server accepts. The identity step comes before a
// draft exists and lives on the start page only, so it is not a stored state. "kembali" is not a
// move: it restores an earlier snapshot.
export const DRAFT_MOVES = {
  // An emergency goes from its place to its questions, with no neighbourhood between.
  place: ["place_confirm", "neighbourhood", "asking", "cancelled", "expired"],
  place_confirm: ["neighbourhood", "asking", "place", "cancelled", "expired"],
  neighbourhood: ["asking", "cancelled", "expired"],
  asking: ["guided_chronology", "free_story", "photos", "summary", "cancelled", "expired"],
  // News added to a sent report tells its chronology and its photos straight from the summary.
  guided_chronology: ["asking", "photos", "summary", "cancelled", "expired"],
  free_story: ["asking", "photos", "cancelled", "expired"],
  photos: ["summary", "cancelled", "expired"],
  summary: ["sent", "asking", "guided_chronology", "photos", "cancelled", "expired"],
  sent: [],
  cancelled: [],
  expired: [],
} as const satisfies Record<string, readonly string[]>;

export type DraftState = keyof typeof DRAFT_MOVES;

export const DRAFT_STATES = Object.keys(DRAFT_MOVES) as DraftState[];

// A stored draft starts here, inside the consent transaction.
export const FIRST_DRAFT_STATE: DraftState = "place";

export function isDraftState(value: unknown): value is DraftState {
  return Object.hasOwn(DRAFT_MOVES, value as string);
}

export function isFinal(state: DraftState): boolean {
  return DRAFT_MOVES[state].length === 0;
}

export function canMove(from: DraftState, to: DraftState): boolean {
  return (DRAFT_MOVES[from] as readonly DraftState[]).includes(to);
}
