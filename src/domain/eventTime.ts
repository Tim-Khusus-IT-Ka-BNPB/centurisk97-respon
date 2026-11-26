import type { EventTimeValue } from "./fieldState";
import { folded } from "./text";
import { DAY_MS, HOUR_MS, MINUTE_MS } from "./time";

export type Zone = "WIB" | "WITA" | "WIT";

const EVENT_TIME_AHEAD_MS = 10 * MINUTE_MS;
const EVENT_TIME_BACK_MS = 30 * DAY_MS;

const WITA_PROVINCES: ReadonlySet<string | null> = new Set([
  "51",
  "52",
  "53",
  "63",
  "64",
  "65",
  "71",
  "72",
  "73",
  "74",
  "75",
  "76",
]);
const WIT_PROVINCES: ReadonlySet<string | null> = new Set(["81", "82", "91", "92", "93", "94", "95", "96"]);
const OFFSET_HOURS: Readonly<Record<Zone, number>> = { WIB: 7, WITA: 8, WIT: 9 };

// The zone of a province code; WIB before a place is known.
export function provinceZone(provinceCode: string | null): Zone {
  if (WIT_PROVINCES.has(provinceCode)) return "WIT";
  if (WITA_PROVINCES.has(provinceCode)) return "WITA";
  return "WIB";
}

export function zoneOffsetMs(zone: Zone): number {
  return OFFSET_HOURS[zone] * HOUR_MS;
}

// The local calendar date ("YYYY-MM-DD") of an instant in a zone.
export function localDate(instantMs: number, zone: Zone): string {
  return new Date(instantMs + zoneOffsetMs(zone)).toISOString().slice(0, 10);
}

// The local clock time ("HH:MM") of an instant in a zone.
export function localClock(instantMs: number, zone: Zone): string {
  return new Date(instantMs + zoneOffsetMs(zone)).toISOString().slice(11, 16);
}

const TIME = /^(\d{2}):(\d{2})$/;

// A real calendar date written exactly as YYYY-MM-DD.
function validDate(text: string): boolean {
  const [year, month, day] = text.split("-").map(Number) as [number, number, number];
  const time = Date.UTC(year, month - 1, day);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === text;
}

function validTime(text: string): boolean {
  const match = TIME.exec(text);
  return match !== null && Number(match[1]) <= 23 && Number(match[2]) <= 59;
}

export type EventTimeError = "dateFormat" | "hourFormat" | "inFuture" | "tooOld";

// The event time rule: at most 10 minutes ahead and at most 30 days back, both inclusive.
// A date with no hour passes when that local date can hold such a moment.
export function checkEventTime(value: EventTimeValue, nowMs: number): EventTimeError | null {
  if (value.kind === "olderThan30Days") return null;
  if (!validDate(value.localDate)) return "dateFormat";
  if (value.kind === "dateOnly") {
    if (value.localDate > localDate(nowMs + EVENT_TIME_AHEAD_MS, value.zone)) return "inFuture";
    if (value.localDate < localDate(nowMs - EVENT_TIME_BACK_MS, value.zone)) return "tooOld";
    return null;
  }
  if (!validTime(value.localTime)) return "hourFormat";
  const instant = Date.parse(`${value.localDate}T${value.localTime}:00Z`) - zoneOffsetMs(value.zone);
  if (instant > nowMs + EVENT_TIME_AHEAD_MS) return "inFuture";
  if (instant < nowMs - EVENT_TIME_BACK_MS) return "tooOld";
  return null;
}

// The instant of an event time with its hour; null for a date alone or an old event.
export function eventInstantMs(value: EventTimeValue): number | null {
  if (value.kind !== "dateTime") return null;
  return Date.parse(`${value.localDate}T${value.localTime}:00Z`) - zoneOffsetMs(value.zone);
}

const MONTHS = [
  "januari",
  "februari",
  "maret",
  "april",
  "mei",
  "juni",
  "juli",
  "agustus",
  "september",
  "oktober",
  "november",
  "desember",
];
const WRITTEN_DATE = /(\d{1,2}) ([a-z]{3,9}) (\d{4})/;
const NUMERIC_DATE = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/;
// A day and a month with no year, which is never the "4/2" of a longer number.
const WRITTEN_DAY = /(\d{1,2}) ([a-z]{3,9})\b/g;
const NUMERIC_DAY = /(?<![\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/;
const AGO = /\b(\d{1,2} ?|se)(menit|jam|hari) (?:yang )?lalu\b/;
const AGO_MS = { menit: MINUTE_MS, jam: HOUR_MS, hari: DAY_MS } as const;
const CLOCK = /(\d{1,2})[.:](\d{2})/;
const SPOKEN_HOUR = /(?:jam|pukul|pkl)\s*(\d{1,2})(?!\d)/;

const pad = (n: number) => String(n).padStart(2, "0");

const dayOf = (localMs: number) => Math.floor(localMs / DAY_MS) * DAY_MS;

function relativeDay(text: string, localNowMs: number): number | null {
  const ago = AGO.exec(text);
  // So long ago tells the day, not the hour.
  if (ago) {
    const count = ago[1] === "se" ? 1 : Number(ago[1]);
    return dayOf(localNowMs - count * AGO_MS[ago[2] as keyof typeof AGO_MS]);
  }
  const todayMs = dayOf(localNowMs);
  if (text.includes("kemarin lusa")) return todayMs - 2 * DAY_MS;
  if (text.includes("kemarin")) return todayMs - DAY_MS;
  // "Tadi malam" said before 18.00 means last night.
  if (/semalam|tadi malam/.test(text)) return localNowMs - todayMs < 18 * HOUR_MS ? todayMs - DAY_MS : todayMs;
  if (/hari ini|tadi|barusan|sekarang|baru saja/.test(text)) return todayMs;
  return null;
}

// The last such day: this year's, or last year's when this year's is still to come.
function lastSuchDay(day: string, month: number, localNowMs: number): string {
  const inYear = (year: number) => `${year}-${pad(month)}-${pad(Number(day))}`;
  const year = new Date(localNowMs).getUTCFullYear();
  return inYear(Date.parse(inYear(year)) > localNowMs ? year - 1 : year);
}

function dayAndMonth(text: string, localNowMs: number): { date: string; matched: string } | null {
  for (const [matched, day, word] of text.matchAll(WRITTEN_DAY)) {
    const month = MONTHS.findIndex((name) => name === word || name.slice(0, 3) === word);
    if (month >= 0) return { date: lastSuchDay(day as string, month + 1, localNowMs), matched };
  }
  const numeric = NUMERIC_DAY.exec(text);
  return numeric && { date: lastSuchDay(numeric[1] as string, Number(numeric[2]), localNowMs), matched: numeric[0] };
}

function writtenDate(text: string, localNowMs: number): { date: string; matched: string } | null {
  const written = WRITTEN_DATE.exec(text);
  if (written) {
    // A month is known by its first three letters, so "Des" and a misspelt "Desmber" both read.
    const month = MONTHS.findIndex((name) => name.startsWith((written[2] as string).slice(0, 3)));
    if (month >= 0) return { date: `${written[3]}-${pad(month + 1)}-${pad(Number(written[1]))}`, matched: written[0] };
  }
  const numeric = NUMERIC_DATE.exec(text);
  if (!numeric) return dayAndMonth(text, localNowMs);
  const year = Number(numeric[3]) < 100 ? 2000 + Number(numeric[3]) : Number(numeric[3]);
  return { date: `${year}-${pad(Number(numeric[2]))}-${pad(Number(numeric[1]))}`, matched: numeric[0] };
}

// The hour told in folded words: "14.30", "jam 5 sore". Null when none is.
export function readClock(text: string): string | null {
  const clock = CLOCK.exec(text);
  const spoken = clock ? null : SPOKEN_HOUR.exec(text);
  if (!clock && !spoken) return null;
  let hour = Number(clock ? clock[1] : (spoken as RegExpExecArray)[1]);
  const minute = clock ? Number(clock[2]) : 0;
  if (text.includes("siang") && hour < 6) hour += 12;
  else if (text.includes("sore") && hour < 12) hour += 12;
  else if (text.includes("malam") && hour >= 6 && hour < 12) hour += 12;
  return `${pad(hour)}:${pad(minute)}`;
}

export type ParsedEventTime = { readonly value: EventTimeValue } | { readonly error: "dateRequired" | EventTimeError };

// Reads an event time from typed words. The date is required; the hour is optional and never guessed.
export function parseEventTimeText(text: string, nowMs: number, zone: Zone): ParsedEventTime {
  const words = folded(text);
  const localNowMs = nowMs + zoneOffsetMs(zone);
  const explicit = writtenDate(words, localNowMs);
  const relative = explicit ? null : relativeDay(words, localNowMs);
  if (!explicit && relative === null) return { error: "dateRequired" };
  const date = explicit ? explicit.date : new Date(relative as number).toISOString().slice(0, 10);
  const time = readClock(explicit ? words.replace(explicit.matched, " ") : words);
  const value: EventTimeValue =
    time === null
      ? { kind: "dateOnly", localDate: date, zone }
      : { kind: "dateTime", localDate: date, localTime: time, zone };
  const error = checkEventTime(value, nowMs);
  return error ? { error } : { value };
}
