import { MINUTE_MS } from "./time";

// How fast each agency answers (K12): from a report sent to its first seen and to it being taken in
// hand, beside how easy its reporters found reporting. Never a ranking; too few say nothing.

const RESPONSE_MIN_REPORTS = 5;

export type ResponseRow = {
  readonly regencyCode: string;
  readonly sentMs: number;
  readonly seenMs: number | null;
  readonly takenMs: number | null;
  // How easy the reporter found reporting, 1 hard to 5 easy, asked right after sending; null when
  // not answered. It rates the reporting, not the agency.
  readonly rating: number | null;
};

// Whole minutes.
type Spread = { readonly count: number; readonly median: number; readonly p90: number };

// The reporters' answers on how easy reporting was: how many, and their mean to one decimal.
type Ease = { readonly count: number; readonly average: number };

type ResponseFigures = {
  readonly seen: Spread | null;
  readonly taken: Spread | null;
  readonly notSeen: number;
  readonly notTaken: number;
  // Gaps that ran backwards, left out of the figures.
  readonly dropped: number;
  // Null under 5 answers.
  readonly ease: Ease | null;
};

export type AgencyResponse = {
  readonly regencyCode: string;
  readonly reports: number;
  // Null under 5 reports.
  readonly figures: ResponseFigures | null;
};

// The value at this share of a sorted list, as upstream takes it: the nearest rank.
function nearestRank(sorted: readonly number[], share: number): number {
  return sorted[Math.ceil(share * sorted.length) - 1] as number;
}

function spreadOf(gaps: readonly number[]): Spread | null {
  if (gaps.length === 0) return null;
  const sorted = [...gaps].sort((a, b) => a - b);
  const minutes = (share: number) => Math.round(nearestRank(sorted, share) / MINUTE_MS);
  return { count: sorted.length, median: minutes(0.5), p90: minutes(0.9) };
}

function easeOf(reports: readonly ResponseRow[]): Ease | null {
  const ratings = reports.flatMap((report) => (report.rating === null ? [] : [report.rating]));
  if (ratings.length < RESPONSE_MIN_REPORTS) return null;
  const mean = ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
  return { count: ratings.length, average: Math.round(mean * 10) / 10 };
}

function figuresOf(reports: readonly ResponseRow[]): ResponseFigures {
  const gaps = (at: (report: ResponseRow) => number | null) =>
    reports.flatMap((report) => {
      const reached = at(report);
      return reached === null ? [] : [reached - report.sentMs];
    });
  const seen = gaps((report) => report.seenMs);
  const taken = gaps((report) => report.takenMs);
  const kept = (list: readonly number[]) => list.filter((gap) => gap >= 0);
  return {
    seen: spreadOf(kept(seen)),
    taken: spreadOf(kept(taken)),
    notSeen: reports.length - seen.length,
    notTaken: reports.length - taken.length,
    dropped: seen.length + taken.length - kept(seen).length - kept(taken).length,
    ease: easeOf(reports),
  };
}

// Each agency's month, in the order of its code.
export function responseByAgency(reports: readonly ResponseRow[]): AgencyResponse[] {
  const codes = [...new Set(reports.map((report) => report.regencyCode))].sort();
  return codes.map((regencyCode) => {
    const own = reports.filter((report) => report.regencyCode === regencyCode);
    return {
      regencyCode,
      reports: own.length,
      figures: own.length < RESPONSE_MIN_REPORTS ? null : figuresOf(own),
    };
  });
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const WIB_OFFSET_MS = 7 * 60 * MINUTE_MS;

// A month as "YYYY-MM" in WIB: when it starts and when the next one does. Null for any other text.
export function monthSpan(text: string): { readonly fromMs: number; readonly toMs: number } | null {
  const match = MONTH.exec(text);
  if (match === null) return null;
  const start = (months: number) => Date.UTC(Number(match[1]), Number(match[2]) - 1 + months, 1) - WIB_OFFSET_MS;
  return { fromMs: start(0), toMs: start(1) };
}

// The WIB month an instant is in.
export const monthOf = (ms: number): string => new Date(ms + WIB_OFFSET_MS).toISOString().slice(0, 7);
