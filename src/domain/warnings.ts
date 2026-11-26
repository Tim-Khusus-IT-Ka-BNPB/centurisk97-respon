import { localClock, localDate } from "./eventTime";
import { cellLevel, type ForecastFile, type Level } from "./forecast";
import { HOUR_MS } from "./time";

// Who may be warned of what (M07, upstream pw_inti.js): a phone picks up to three districts, the
// hazards it wants, and from which level. Region codes only, never a point.

// The outlook's hazards a phone can be warned of, each a bit of the subscription's choice.
export const WARNING_HAZARDS = [
  ["BNJ", 1],
  ["LSR", 2],
  ["ASP", 4],
  ["CEX", 8],
] as const;
export const ALL_HAZARDS = 15;
export const MAX_DISTRICTS = 3;
// Phones in all: past it a new phone is refused, one already in may still change.
export const MAX_SUBSCRIBERS = 5000;

// Only the browsers' own push services, so the sender is never pointed at any other address.
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /(^|\.)push\.apple\.com$/,
  /(^|\.)notify\.windows\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
];

export function pushEndpointOk(endpoint: string): boolean {
  if (endpoint.length > 1000 || !URL.canParse(endpoint)) return false;
  const url = new URL(endpoint);
  return url.protocol === "https:" && PUSH_HOSTS.some((host) => host.test(url.hostname));
}

// The phone's own keys for the message, as the browser gives them (base64url).
export const pushKeysOk = (p256dh: string, auth: string) =>
  /^[A-Za-z0-9_-]{80,100}$/.test(p256dh) && /^[A-Za-z0-9_-]{20,30}$/.test(auth);

// A level that rose for a regency, hazard and day since the last one sent: only a rise is sent,
// never a fall (upstream ALGORITMA 2, Q10).
export type Rise = {
  readonly regencyCode: string;
  readonly regencyName: string;
  readonly hazard: string;
  readonly date: string;
  readonly level: Level;
};

// An outlook older than this is never sent from.
const FRESH_MS = 36 * HOUR_MS;

// Waspada waits out the night, 22.00 to 05.00 WIB (Q4); Siaga and Awas go at once.
export const heldAtNight = (level: Level, nowMs: number) => {
  const hour = Number(localClock(nowMs, "WIB").slice(0, 2));
  return level === 1 && (hour >= 22 || hour < 5);
};

export const sentKey = (rise: Pick<Rise, "regencyCode" | "hazard" | "date">) =>
  `${rise.regencyCode}|${rise.hazard}|${rise.date}`;

// Every rise of today and the days ahead, by the file's own levels.
export function risenWarnings(file: ForecastFile, sent: ReadonlyMap<string, number>, nowMs: number): Rise[] {
  if (nowMs - Date.parse(file.dibuat) > FRESH_MS) return [];
  const today = localDate(nowMs, "WIB");
  return file.kab.flatMap((regency) =>
    WARNING_HAZARDS.flatMap(([hazard]) => {
      const code = file.kode[hazard];
      const rows = regency[hazard] as readonly (readonly (number | null)[])[] | undefined;
      return (code?.hari ?? []).flatMap((date, index) => {
        const level = cellLevel(hazard, code?.kol, rows?.[index]);
        const rise = {
          regencyCode: `${regency.id.slice(0, 2)}.${regency.id.slice(2)}`,
          regencyName: regency.nama,
          hazard,
          date,
        };
        return date >= today && level !== null && level > (sent.get(sentKey(rise)) ?? 0) && !heldAtNight(level, nowMs)
          ? [{ ...rise, level }]
          : [];
      });
    }),
  );
}

// The one rise a phone is told of: of its hazards, at or past its level, the highest and soonest.
export function riseFor(rises: readonly Rise[], hazards: number, threshold: number): Rise | null {
  const bit = new Map<string, number>(WARNING_HAZARDS);
  const mine = rises.filter((rise) => ((bit.get(rise.hazard) as number) & hazards) !== 0 && rise.level >= threshold);
  return mine.toSorted((a, b) => b.level - a.level || a.date.localeCompare(b.date))[0] ?? null;
}
