import { zoneOffsetMs } from "./eventTime";
import type { TicketStatus } from "./stages";
import { DAY_MS, MINUTE_MS } from "./time";

// Weekly counts for research (K62, D91 to D93): one row per regency, hazard and ISO week in WIB.
// No ticket, village, point, text, photo, name or number leaves here. A cell from fewer than 3
// reporters is written "<3" with its details empty, so a reporter in a quiet regency cannot be
// guessed. The gap to the official record stays "not yet available" until reports are matched to
// it upstream (LA-25): never zero.

const SMALL_CELL = 3;

export type AggregateInput = {
  readonly provinceCode: string;
  readonly provinceName: string;
  readonly regencyCode: string;
  readonly regencyName: string;
  readonly hazardType: string;
  // The event time when it is known.
  readonly eventMs: number | null;
  readonly sentMs: number;
  readonly numberKey: string;
  readonly placedPhoto: boolean;
  readonly status: TicketStatus;
};

type Hidden = typeof HIDDEN;
const HIDDEN = `<${SMALL_CELL}` as const;

export type AggregateRow = {
  readonly week: string;
  readonly provinceCode: string;
  readonly provinceName: string;
  readonly regencyCode: string;
  readonly regencyName: string;
  readonly hazardType: string;
  readonly reports: number | Hidden;
  readonly reporters: number | Hidden;
  readonly placedPhotos: number | null;
  readonly invalid: number | null;
  // Whole minutes from the event to the send, of reports with an event time.
  readonly medianMinutesToReport: number | null;
};

// The ISO 8601 week of the WIB date.
export function isoWeek(instantMs: number): string {
  const local = new Date(instantMs + zoneOffsetMs("WIB"));
  const day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const thursday = new Date(day + (4 - (new Date(day).getUTCDay() || 7)) * DAY_MS);
  const year = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / (7 * DAY_MS)) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  const value =
    sorted.length % 2 ? (sorted[middle] as number) : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
  return Math.round(value);
}

export function aggregateRows(reports: readonly AggregateInput[]): readonly AggregateRow[] {
  const cells = new Map<string, AggregateInput[]>();
  for (const report of reports) {
    const key = `${isoWeek(report.eventMs ?? report.sentMs)}|${report.regencyCode}|${report.hazardType}`;
    cells.set(key, [...(cells.get(key) ?? []), report]);
  }
  return [...cells.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, members]) => {
      const first = members[0] as AggregateInput;
      const cell = {
        week: key.split("|")[0] as string,
        provinceCode: first.provinceCode,
        provinceName: first.provinceName,
        regencyCode: first.regencyCode,
        regencyName: first.regencyName,
        hazardType: first.hazardType,
      };
      const reporters = new Set(members.map((member) => member.numberKey)).size;
      if (reporters < SMALL_CELL)
        return {
          ...cell,
          reports: HIDDEN,
          reporters: HIDDEN,
          placedPhotos: null,
          invalid: null,
          medianMinutesToReport: null,
        };
      const delays = members
        .filter((member) => member.eventMs !== null && member.sentMs >= member.eventMs)
        .map((member) => (member.sentMs - (member.eventMs as number)) / MINUTE_MS);
      return {
        ...cell,
        reports: members.length,
        reporters,
        placedPhotos: members.filter((member) => member.placedPhoto).length,
        invalid: members.filter((member) => member.status === "invalid").length,
        medianMinutesToReport: median(delays),
      };
    });
}
