import type { FieldStates } from "./fieldState";
import { applicableFields, chosenHazardType } from "./fields/applicable";
import type { FieldId } from "./fields/catalogue";
import { PHOTO } from "./photoChecks";
import type { TicketStatus } from "./stages";
import { HOUR_MS } from "./time";
import { versionChanges } from "./versions";

// News a reporter adds to a report already sent (A12, Q26): it becomes the next version, and what
// the report is about stays as it was.

export const FOLLOW_UP = { windowMs: 72 * HOUR_MS, versions: 10, photos: 20 } as const;

export type FollowUpRefusal = "tooLate" | "ended" | "tooMany";

// When a follow-up to a report sent then is no longer taken.
export const followUpClosesAt = (sentAtMs: number): number => sentAtMs + FOLLOW_UP.windowMs;

// Why news is no longer taken, or null while it is.
export function followUpRefusal(
  report: { readonly sentAtMs: number; readonly status: TicketStatus; readonly versions: number },
  nowMs: number,
): FollowUpRefusal | null {
  if (report.status === "closed" || report.status === "invalid") return "ended";
  if (nowMs > followUpClosesAt(report.sentAtMs)) return "tooLate";
  return report.versions >= FOLLOW_UP.versions ? "tooMany" : null;
}

// How many photos one follow-up may still add.
export const followUpPhotos = (onReport: number): number =>
  Math.max(0, Math.min(PHOTO.maxPerDraft, FOLLOW_UP.photos - onReport));

const ALWAYS_LOCKED: readonly FieldId[] = ["place", "neighbourhood", "eventTime"];
const ABOUT_HAZARD: readonly FieldId[] = ["hazardType", "hazardSubtype"];

// A value news may not change: what happened, where and when. A report sent before its hazard was
// known may still be told it.
export const isLocked = (base: FieldStates, fieldId: FieldId): boolean =>
  ALWAYS_LOCKED.includes(fieldId) || (ABOUT_HAZARD.includes(fieldId) && chosenHazardType(base) !== null);

// What the reporter told that the report did not hold when the follow-up was opened. A box left
// empty or "tidak tahu" takes nothing back: what was known stays known.
export function newsOf(base: FieldStates, now: FieldStates): FieldStates {
  const told = versionChanges(base, now).filter(
    ({ fieldId, to }) => (to?.state === "value" || to?.state === "none") && !isLocked(base, fieldId),
  );
  return Object.fromEntries(told.map(({ fieldId, to }) => [fieldId, to]));
}

// The news put onto the newest version, value by value, so what an officer put right meanwhile is
// kept. Only what applies then is kept: a count told as none takes its follow-up values with it.
export function withNews(latest: FieldStates, news: FieldStates): FieldStates {
  const states: FieldStates = { ...latest, ...news };
  return Object.fromEntries(
    applicableFields(states).flatMap((field) => {
      const state = states[field.id as FieldId];
      return state === undefined ? [] : [[field.id, state]];
    }),
  );
}

// Fields the news opened: they apply now, did not before, and were never asked.
export const openedBy = (base: FieldStates, now: FieldStates): readonly FieldId[] => {
  const before = new Set(applicableFields(base).map((field) => field.id));
  return applicableFields(now)
    .map((field) => field.id as FieldId)
    .filter((fieldId) => !before.has(fieldId) && !isLocked(base, fieldId) && now[fieldId] === undefined);
};
