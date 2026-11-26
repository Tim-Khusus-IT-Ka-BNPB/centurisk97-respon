import { DAY_MS, HOUR_MS, MINUTE_MS } from "./time";

// A report kept on a phone with no signal (lapor-luring LR-09, Q3): the phone's clock is a note for
// the desk, never the time of the event or of the report. Sent more than 2 hours after it was saved,
// it no longer rings as a live emergency. Both times are the phone's own, so a clock that is off
// does not make a fresh report look late; a time that cannot be the phone's keeps the alarm on.
const KEPT_MS = 14 * DAY_MS;
const AHEAD_MS = 5 * MINUTE_MS;
export const LATE_MS = 2 * HOUR_MS;

// A phone's time the service can believe: no more than 5 minutes ahead, no more than 14 days old.
function believable(ms: number | undefined, nowMs: number): ms is number {
  const at = ms ?? Number.NaN;
  return at <= nowMs + AHEAD_MS && at >= nowMs - KEPT_MS;
}

export type OfflineMark = {
  // When the phone saved it, or null when its clock could not be believed.
  readonly savedAt: number | null;
  readonly late: boolean;
};

export function offlineMark(
  savedMs: number | undefined,
  sentByPhoneMs: number | undefined,
  nowMs: number,
): OfflineMark {
  if (!believable(savedMs, nowMs)) return { savedAt: null, late: false };
  const late = believable(sentByPhoneMs, nowMs) && sentByPhoneMs - savedMs > LATE_MS;
  return { savedAt: savedMs, late };
}

// Photos kept with a report made with no signal (LR-06): from the camera, at most 3, judged against
// when the phone saved the report, with 2 minutes' leeway, as the camera's clock is the phone's too.
export const OFFLINE_PHOTOS = 3;
const PHOTO_LEEWAY_MS = 2 * MINUTE_MS;

// The time a kept photo is checked at: the phone's save time and its leeway, or now when the save
// time could not be believed.
export const offlinePhotoClock = (savedAt: number | null, nowMs: number): number =>
  savedAt === null ? nowMs : savedAt + PHOTO_LEEWAY_MS;
