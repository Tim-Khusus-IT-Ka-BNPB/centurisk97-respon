// A report's own figures for the desk table. A count is the reporter's number, an explicit
// none is 0, and anything not known is null: empty is never shown as zero (HF2).
type StateLike = { readonly state: string; readonly value?: unknown };

export type Impact = {
  readonly dead: number | null;
  readonly missing: number | null;
  readonly injured: number | null;
  readonly displaced: number | null;
  // Heavy, moderate and light together; partial when one of the three is not known.
  readonly houses: { readonly count: number; readonly partial: boolean } | null;
};

function countOf(state: StateLike | undefined): number | null {
  if (state?.state === "value") return state.value as number;
  return state?.state === "none" ? 0 : null;
}

const HOUSES = ["housesHeavy", "housesModerate", "housesLight"] as const;

export function impactOf(states: Readonly<Record<string, StateLike | undefined>>): Impact {
  const houses = HOUSES.map((id) => countOf(states[id]));
  const known = houses.filter((count): count is number => count !== null);
  return {
    dead: countOf(states.dead),
    missing: countOf(states.missing),
    injured: countOf(states.injured),
    displaced: countOf(states.displacedPeople),
    houses:
      known.length === 0
        ? null
        : { count: known.reduce((sum, count) => sum + count, 0), partial: known.length < HOUSES.length },
  };
}
