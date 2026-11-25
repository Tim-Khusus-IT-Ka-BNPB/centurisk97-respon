import { localDate } from "./eventTime";
import { DAY_MS, HOUR_MS } from "./time";

// The queue's period filter, counted in WIB days: "today" is since WIB midnight, a week is today
// and the six days before it.
export const DESK_PERIODS = ["today", "week", "month", "all"] as const;
export type DeskPeriod = (typeof DESK_PERIODS)[number];

const PERIOD_DAYS = { today: 1, week: 7, month: 30 } as const;

export function periodStart(period: DeskPeriod, nowMs: number): number | null {
  if (period === "all") return null;
  const wibMidnight = Date.parse(`${localDate(nowMs, "WIB")}T00:00:00Z`) - 7 * HOUR_MS;
  return wibMidnight - (PERIOD_DAYS[period] - 1) * DAY_MS;
}

// What a report must hold to be shown: someone dead, missing or hurt; someone displaced; a damaged
// house; or a photo.
export const DESK_HAS = ["victims", "displaced", "houses", "photos"] as const;
export type DeskHas = (typeof DESK_HAS)[number];

export const DESK_PAGE_SIZE = 50;

// The map draws at most this many points, the gallery this many photos, newest first.
export const MAP_POINTS = 2000;
export const GALLERY_PHOTOS = 200;
