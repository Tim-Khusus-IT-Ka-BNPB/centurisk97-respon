import type { Zone } from "./eventTime";
import { distanceKm, type Point } from "./geo";
import { HOUR_MS, MINUTE_MS } from "./time";

// Why a photo's GPS may not be where the phone was (upstream D11, nilaiGps): marked, never refused.
// The phone's clock in another zone than the place, as a fake location app leaves it; a network
// outside Indonesia; or a jump from the draft's photo before faster than a car or a boat.
export const GPS_DOUBTS = ["zone", "abroad", "jump"] as const;
export type GpsDoubt = (typeof GPS_DOUBTS)[number];

// The time zones a phone in Indonesia is set to, as its browser names them.
const PHONE_ZONES: Readonly<Record<string, Zone>> = {
  "Asia/Jakarta": "WIB",
  "Asia/Pontianak": "WIB",
  "Asia/Makassar": "WITA",
  "Asia/Jayapura": "WIT",
};

export const JUMP = { minKm: 50, maxKmPerHour: 300 } as const;

export type GpsDoubtInput = {
  // The photo's point; with none there is nothing to doubt.
  readonly point: Point | null;
  readonly atMs: number;
  // The phone's own time zone, as its browser names it; null when it sent none.
  readonly phoneZone: string | null;
  // The zone of the report's place.
  readonly placeZone: Zone;
  // The network's country, as the edge read it; null when unknown.
  readonly country: string | null;
  // The draft's photo before this one, with a point.
  readonly previous: { readonly point: Point; readonly atMs: number } | null;
};

export function gpsDoubts(input: GpsDoubtInput): readonly GpsDoubt[] {
  if (input.point === null) return [];
  const doubts: GpsDoubt[] = [];
  if (input.phoneZone !== null && PHONE_ZONES[input.phoneZone] !== input.placeZone) doubts.push("zone");
  if (input.country !== null && input.country !== "ID") doubts.push("abroad");
  if (input.previous !== null) {
    const km = distanceKm(input.point, input.previous.point);
    const hours = Math.max(input.atMs - input.previous.atMs, MINUTE_MS) / HOUR_MS;
    // Stryker disable next-line EqualityOperator: exactly 50 km or 300 km/h is not writable in floats
    if (km > JUMP.minKm && km / hours > JUMP.maxKmPerHour) doubts.push("jump");
  }
  return doubts;
}
