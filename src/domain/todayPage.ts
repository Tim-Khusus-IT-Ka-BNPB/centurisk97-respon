import type { EventTimeValue } from "./fieldState";
import type { Impact } from "./impact";
import { HOUR_MS } from "./time";

// The public "today" page (upstream lapor-kejadian, row 36, D4 and A3): an event shows while one of
// its reports meets all five conditions, and for 24 hours after its BPBD's Valid check.
export const TODAY_CONDITIONS = ["valid", "bpbd", "ticket", "version", "pull"] as const;
export type TodayCondition = (typeof TODAY_CONDITIONS)[number];
export const TODAY_WINDOW_MS = 24 * HOUR_MS;

export type TodayCheck = {
  readonly id: number;
  readonly result: string;
  readonly atMs: number;
  // Who checked, by role and region; null on checks from before these were kept, never counted.
  readonly role: string | null;
  readonly level: string | null;
  readonly code: string | null;
};

export type TodayReport = {
  readonly villageCode: string;
  readonly status: string;
  readonly checks: readonly TodayCheck[];
  // When each version of its values was made, the first one too.
  readonly versionsAtMs: readonly number[];
  readonly pulls: readonly { readonly id: number; readonly pulled: boolean }[];
};

// The BPBD of the report's own region: a regional account whose regency or province holds the village.
const ownBpbd = (check: TodayCheck, villageCode: string) =>
  check.role === "regionalOfficer" &&
  ((check.level === "regency" && check.code === villageCode.slice(0, 5)) ||
    (check.level === "province" && check.code === villageCode.slice(0, 2)));

// The newest check by that BPBD, by time, then by its order when two share a time. A later check by
// anyone else, BNPB's too, neither replaces nor undoes it.
export const bpbdCheck = (report: TodayReport) =>
  report.checks
    .filter((one) => ownBpbd(one, report.villageCode))
    .reduce<TodayCheck | null>(
      (last, one) =>
        last === null || one.atMs > last.atMs || (one.atMs === last.atMs && one.id > last.id) ? one : last,
      null,
    );

// Each condition in turn, for the desk's list as much as for the page.
export function todayConditions(report: TodayReport): Readonly<Record<TodayCondition, boolean>> {
  const check = bpbdCheck(report);
  const lastPull = report.pulls.reduce<{ id: number; pulled: boolean } | null>(
    (last, one) => (last === null || one.id > last.id ? one : last),
    null,
  );
  return {
    valid: check?.result === "valid",
    bpbd: check !== null,
    ticket: report.status !== "invalid",
    // With no check there is no "after": the first two conditions hold it back.
    version: !report.versionsAtMs.some((atMs) => atMs > (check?.atMs ?? Number.POSITIVE_INFINITY)),
    pull: lastPull?.pulled !== true,
  };
}

// When the report was verified: its BPBD's newest check, if all five hold; else null.
export function verifiedAtMs(report: TodayReport): number | null {
  const conditions = todayConditions(report);
  return TODAY_CONDITIONS.every((one) => conditions[one]) ? (bpbdCheck(report) as TodayCheck).atMs : null;
}

export const shownToday = (verifiedMs: number | null, nowMs: number) =>
  verifiedMs !== null && verifiedMs > nowMs - TODAY_WINDOW_MS;

// Each figure as a range across the event's verified reports, a figure no one knows left out; never a
// sum (upstream Q6).
type ImpactRange = { readonly min: number; readonly max: number };
const FIGURES = ["dead", "missing", "injured", "displaced", "houses"] as const;
export type TodayImpact = Partial<Record<(typeof FIGURES)[number], ImpactRange>>;

export function impactRanges(impacts: readonly Impact[]): TodayImpact {
  const ranges: Partial<Record<(typeof FIGURES)[number], ImpactRange>> = {};
  for (const figure of FIGURES) {
    const known = impacts.flatMap((impact) => {
      const value = figure === "houses" ? (impact.houses?.count ?? null) : impact[figure];
      return value === null ? [] : [value];
    });
    if (known.length > 0) ranges[figure] = { min: Math.min(...known), max: Math.max(...known) };
  }
  return ranges;
}

// An event's time to the hour only, so a second reporter cannot read the first one's minute (Q19).
export function toTheHour(time: EventTimeValue | null): EventTimeValue | null {
  return time?.kind === "dateTime" ? { ...time, localTime: `${time.localTime.slice(0, 2)}:00` } : time;
}
