// Times travel as a UTC instant plus the zone of the place; each zone has a fixed offset, so
// the page shows the same clock time on any phone, whatever zone the phone is set to.
type Zone = "WIB" | "WITA" | "WIT";
export type Instant = { readonly utc: string; readonly zone: Zone };

const OFFSET_HOURS: Readonly<Record<Zone, number>> = { WIB: 7, WITA: 8, WIT: 9 };
const HOUR_MS = 3_600_000;

const dayMonthYear = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const dayMonth = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", timeZone: "UTC" });

const shifted = ({ utc, zone }: Instant) => new Date(Date.parse(utc) + OFFSET_HOURS[zone] * HOUR_MS);
const two = (value: number) => String(value).padStart(2, "0");

// "14.05", the 24-hour clock with a dot.
export function clockTime(instant: Instant): string {
  const local = shifted(instant);
  return `${two(local.getUTCHours())}.${two(local.getUTCMinutes())}`;
}

// "23 November 2026" in the instant's zone.
export const longDate = (instant: Instant) => dayMonthYear.format(shifted(instant));

// "23 November 2026" for a local date string such as "2026-11-23".
export const localDateText = (localDate: string) => dayMonthYear.format(new Date(`${localDate}T00:00:00Z`));

// "14.30" for a stored local time such as "14:30".
export const localClockText = (localTime: string) => localTime.replace(":", ".");

// When a refused step may be tried again: the clock time, and the date when it is not today there,
// as the catalogue key that words it and its params.
export function retryText(instant: Instant, nowMs: number) {
  const local = shifted(instant);
  const today = shifted({ utc: new Date(nowMs).toISOString(), zone: instant.zone });
  const sameDay = local.toISOString().slice(0, 10) === today.toISOString().slice(0, 10);
  return {
    key: sameDay ? "common.retryTime.today" : "common.retryTime.otherDay",
    params: { time: clockTime(instant), zone: instant.zone, date: dayMonth.format(local) },
  };
}
