import { localDate } from "./eventTime";
import { DAY_MS, HOUR_MS, MINUTE_MS } from "./time";

type LimitWindow = "minute" | "clockHour" | "wibDay" | "rolling24h" | "rolling30m" | "draftLife" | "standing";

type LimitSubject = "numberSlot" | "device" | "address" | "draft" | "number" | "staff";

// What happens past the limit: the request is refused, or the draft carries on with templates.
type LimitEffect = "refuse" | "templatesOnly";

export type LimitRow = {
  readonly subject: LimitSubject;
  readonly window: LimitWindow;
  readonly max: number;
  readonly effect: LimitEffect;
};

// The one limits table. Copy keys are limit.<id>.
export const LIMITS = {
  "message.minute": { subject: "numberSlot", window: "minute", max: 20, effect: "refuse" },
  "message.hour": { subject: "numberSlot", window: "clockHour", max: 150, effect: "refuse" },
  "message.day": { subject: "numberSlot", window: "wibDay", max: 300, effect: "refuse" },
  "device.messageHour": { subject: "device", window: "clockHour", max: 150, effect: "refuse" },
  "send.rolling": { subject: "numberSlot", window: "rolling24h", max: 5, effect: "refuse" },
  "device.numbers": { subject: "device", window: "standing", max: 5, effect: "refuse" },
  "address.bindings": { subject: "address", window: "clockHour", max: 60, effect: "refuse" },
  "address.messages": { subject: "address", window: "clockHour", max: 2000, effect: "refuse" },
  "address.searches": { subject: "address", window: "clockHour", max: 1000, effect: "refuse" },
  "address.draftReads": { subject: "address", window: "clockHour", max: 2000, effect: "refuse" },
  "address.tracking": { subject: "address", window: "clockHour", max: 300, effect: "refuse" },
  "address.feed": { subject: "address", window: "clockHour", max: 600, effect: "refuse" },
  "address.warnings": { subject: "address", window: "clockHour", max: 30, effect: "refuse" },
  "rating.hour": { subject: "numberSlot", window: "clockHour", max: 30, effect: "refuse" },
  "document.hour": { subject: "numberSlot", window: "clockHour", max: 120, effect: "refuse" },
  "news.hour": { subject: "numberSlot", window: "clockHour", max: 120, effect: "refuse" },
  "model.draft": { subject: "draft", window: "draftLife", max: 30, effect: "templatesOnly" },
  "model.day": { subject: "number", window: "wibDay", max: 150, effect: "templatesOnly" },
  "address.staffSignIn": { subject: "address", window: "clockHour", max: 30, effect: "refuse" },
  "oneTap.device": { subject: "device", window: "rolling30m", max: 1, effect: "refuse" },
  "oneTap.number": { subject: "number", window: "rolling24h", max: 3, effect: "refuse" },
  "address.oneTap": { subject: "address", window: "clockHour", max: 3, effect: "refuse" },
  "desk.alarm": { subject: "staff", window: "clockHour", max: 400, effect: "refuse" },
  "desk.read": { subject: "staff", window: "clockHour", max: 1200, effect: "refuse" },
  "desk.write": { subject: "staff", window: "clockHour", max: 120, effect: "refuse" },
} as const satisfies Record<string, LimitRow>;

export type LimitId = keyof typeof LIMITS;

export const LIMIT_IDS = Object.keys(LIMITS) as LimitId[];

export function limitCopyKey(id: LimitId): string {
  return `limit.${id}`;
}

// Lengths of what a reporter types, in characters.
export const LENGTHS = {
  message: { max: 2000 },
  name: { min: 2, max: 80 },
  officerRegency: { min: 3, max: 80 },
  officerPosition: { min: 2, max: 80 },
  neighbourhood: { min: 1, max: 3 },
  chronologyNote: { max: 300 },
  chronologyWhole: { max: 500 },
  placeNames: { max: 300 },
  otherNeed: { max: 120 },
  placeQuery: { min: 3, max: 60 },
  // A desk note or reply, and the reason a report is set aside, in characters.
  staffText: { max: 1000 },
  staffReason: { min: 5 },
  otherAction: { min: 3, max: 120 },
} as const;

// "kembali" goes back at most this many steps.
export const BACK_STEPS = 12;

// A count at the limit passes; one over is refused.
export function isOverLimit(id: LimitId, countIncludingThis: number): boolean {
  return countIncludingThis > LIMITS[id].max;
}

const WIB_OFFSET_MS = 7 * HOUR_MS;

type FixedWindow = "minute" | "clockHour" | "wibDay";

// Start of the fixed window holding this instant: the counter row it belongs to.
export function windowStart(window: FixedWindow, nowMs: number): number {
  if (window === "minute") return nowMs - (nowMs % MINUTE_MS);
  if (window === "clockHour") return nowMs - (nowMs % HOUR_MS);
  return Date.parse(`${localDate(nowMs, "WIB")}T00:00:00Z`) - WIB_OFFSET_MS;
}

const WINDOW_LENGTH: Readonly<Record<FixedWindow, number>> = { minute: MINUTE_MS, clockHour: HOUR_MS, wibDay: DAY_MS };

// When a refused request may be tried again: the end of its window.
export function retryAt(window: FixedWindow, nowMs: number): number {
  return windowStart(window, nowMs) + WINDOW_LENGTH[window];
}

// For the rolling send limit: a send is allowed again 24 hours after the oldest send counted.
export function rollingRetryAt(oldestSentMs: number): number {
  return oldestSentMs + DAY_MS;
}
