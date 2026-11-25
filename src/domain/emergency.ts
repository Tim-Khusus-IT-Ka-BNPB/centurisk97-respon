import { localClock, localDate, type Zone } from "./eventTime";
import type { FieldStates } from "./fieldState";
import { DAY_MS, MINUTE_MS } from "./time";

// Raising an alarm (K68, K90): the shortest report there is, or one tap with the phone's point.

export const VICTIM_ANSWERS = ["yes", "no", "unknown"] as const;
export type VictimAnswer = (typeof VICTIM_ANSWERS)[number];

export const isVictimAnswer = (value: unknown): value is VictimAnswer => VICTIM_ANSWERS.some((one) => one === value);

// How an emergency reached the desk: through the short conversation, or by one tap.
export type EmergencyKind = "chat" | "oneTap";

// What an emergency report holds when it is sent: it is happening now, and the kind of its hazard,
// when one was told, was not asked. Both are the system's, never the reporter's.
export function emergencyStates(states: FieldStates, nowMs: number, zone: Zone): FieldStates {
  const eventTime = {
    kind: "dateTime",
    localDate: localDate(nowMs, zone),
    localTime: localClock(nowMs, zone),
    zone,
  } as const;
  return {
    ...states,
    ...(states.hazardType?.state === "value"
      ? { hazardSubtype: { state: "value", value: "unknown", origin: "system" } }
      : {}),
    eventTime: { state: "value", value: eventTime, origin: "system" },
  };
}

// One tap is kept from being leaned on (D124): once in 30 minutes from a phone, 3 a day for a number.
export const ONE_TAP = { deviceEveryMs: 30 * MINUTE_MS, perNumberDay: 3 } as const;

// When a phone whose last one-tap report was then may send another; null when it may now.
export function oneTapOpensAt(lastMs: number | null, nowMs: number): number | null {
  const opens = (lastMs ?? Number.NEGATIVE_INFINITY) + ONE_TAP.deviceEveryMs;
  return opens > nowMs ? opens : null;
}

// The same for a number: its sends of the last day, oldest first.
export function oneTapDayOpensAt(sentMs: readonly number[], nowMs: number): number | null {
  const today = sentMs.filter((sent) => sent > nowMs - DAY_MS);
  return today.length < ONE_TAP.perNumberDay ? null : (today.at(-ONE_TAP.perNumberDay) as number) + DAY_MS;
}
