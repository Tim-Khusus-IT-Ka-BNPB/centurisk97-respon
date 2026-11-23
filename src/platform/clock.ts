import type { Clock } from "../ports/clock";

// The fixed clock of local and test starts at its setting and then runs with real time, so a
// walk of many turns does not land in one minute.
export function createClock(fixedMs: number | null, realNow: () => number = Date.now): Clock {
  if (fixedMs === null) return { now: realNow };
  const started = realNow();
  return { now: () => fixedMs + (realNow() - started) };
}
