import { localDate } from "./eventTime";
import { DAY_MS, HOUR_MS } from "./time";

// The feed's period (upstream's picker, e232a08ed): the latest day that has a report, the last 3 or
// 7 WIB days, or everything. Days are counted from WIB midnight, as the desk counts them.
export const FEED_PERIODS = ["latest", "3", "7", "all"] as const;
export type FeedPeriod = (typeof FEED_PERIODS)[number];

const wibMidnight = (ms: number) => Date.parse(`${localDate(ms, "WIB")}T00:00:00Z`) - 7 * HOUR_MS;

// The first moment a report may have been sent to be shown; null shows every one.
export function feedSince(period: FeedPeriod, nowMs: number, newestMs: number | null): number | null {
  if (period === "all") return null;
  if (period === "latest") return newestMs === null ? null : wibMidnight(newestMs);
  return wibMidnight(nowMs) - (Number(period) - 1) * DAY_MS;
}
