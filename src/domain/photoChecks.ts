// The photo step's rules (K75, D11, A4). The checks run in the order of the task's table and the
// first one that fails is the refusal; every other outcome keeps the photo with a badge.

import { distanceKm, GEO, type Point } from "./geo";
import { type Exif, isJpeg } from "./jpeg";
import { MINUTE_MS } from "./time";

export const PHOTO = {
  maxPerDraft: 10,
  maxBytes: 2.5 * 1024 * 1024,
  // Smaller than this is not a photo a phone camera makes.
  minBytes: 1000,
  // Taken longer ago than this is not a new photo (K75).
  freshMs: 5 * MINUTE_MS,
  // A camera clock this far ahead is not trusted as the time taken.
  clockAheadMs: 5 * MINUTE_MS,
} as const;

// The device's own reading when the photo was sent, as the page read it.
export type DeviceFix = {
  readonly lat: number;
  readonly lon: number;
  readonly accuracyM: number;
  readonly readAtMs: number;
};

type PhotoRefusal = "notCamera" | "notFresh" | "farFromDevice" | "format" | "tooMany";

type PhotoBadge = "deviceGps" | "photoData" | "none";
type TimeSource = "photoData" | "deviceGps" | "upload";

export type KeptPhoto = {
  readonly badge: PhotoBadge;
  readonly point: Point | null;
  readonly accuracyM: number | null;
  readonly takenAtMs: number;
  readonly timeSource: TimeSource;
  readonly far: boolean;
};

export type PhotoCheck =
  | { readonly kind: "refused"; readonly rule: PhotoRefusal }
  | ({ readonly kind: "kept" } & KeptPhoto);

export type PhotoInput = {
  readonly bytes: Uint8Array;
  readonly exif: Exif | null;
  readonly nowMs: number;
  readonly device: DeviceFix | null;
  // Where the report says it happened: the GPS reading, or the picked village's centre.
  readonly placePoint: Point | null;
  // Photos already kept in this draft.
  readonly count: number;
  // Used for a camera time written with no offset: the page's own zone, else the report's.
  readonly fallbackOffsetMinutes: number;
};

// Upstream's looser box for a point sent in, edges included. NaN fails every comparison.
const plausible = (point: Point) => point.lat >= -12 && point.lat <= 7 && point.lon >= 94 && point.lon <= 142;

// A device reading counts only when it is a point in the box, 1 km or better, read in the last 10 minutes.
export function usableFix(device: DeviceFix | null, nowMs: number): DeviceFix | null {
  if (device === null || !plausible(device)) return null;
  if (!(device.accuracyM >= 0 && device.accuracyM <= GEO.pointAccuracyM)) return null;
  return Math.abs(nowMs - device.readAtMs) <= GEO.deviceFixMaxAgeMs ? device : null;
}

function takenAt(exif: Exif, fallbackOffsetMinutes: number): number | null {
  if (exif.time === null) return null;
  return exif.time.localMs - (exif.time.offsetMinutes ?? fallbackOffsetMinutes) * MINUTE_MS;
}

export function checkPhoto(input: PhotoInput): PhotoCheck {
  const { exif, nowMs } = input;
  if (exif === null || !exif.camera) return { kind: "refused", rule: "notCamera" };
  const cameraTime = takenAt(exif, input.fallbackOffsetMinutes);
  if (cameraTime !== null && cameraTime < nowMs - PHOTO.freshMs) return { kind: "refused", rule: "notFresh" };
  const fix = usableFix(input.device, nowMs);
  const photoPoint = exif.point && plausible(exif.point) ? exif.point : null;
  // Stryker disable next-line EqualityOperator: two points exactly 5 km apart are not writable in floats
  if (fix && photoPoint && distanceKm(fix, photoPoint) > GEO.photoFromDeviceKm)
    return { kind: "refused", rule: "farFromDevice" };
  if (!isJpeg(input.bytes) || input.bytes.length < PHOTO.minBytes || input.bytes.length > PHOTO.maxBytes)
    return { kind: "refused", rule: "format" };
  if (input.count >= PHOTO.maxPerDraft) return { kind: "refused", rule: "tooMany" };
  const trustedTime = (cameraTime ?? Number.POSITIVE_INFINITY) <= nowMs + PHOTO.clockAheadMs ? cameraTime : null;
  const point = fix ? { lat: fix.lat, lon: fix.lon } : photoPoint;
  const time =
    trustedTime !== null
      ? { takenAtMs: trustedTime, timeSource: "photoData" as const }
      : fix
        ? { takenAtMs: fix.readAtMs, timeSource: "deviceGps" as const }
        : { takenAtMs: nowMs, timeSource: "upload" as const };
  return {
    kind: "kept",
    badge: fix ? "deviceGps" : photoPoint ? "photoData" : "none",
    point,
    accuracyM: fix ? fix.accuracyM : null,
    ...time,
    // Stryker disable next-line EqualityOperator: two points exactly 10 km apart are not writable in floats
    far: point !== null && input.placePoint !== null && distanceKm(point, input.placePoint) > GEO.photoFarFromPlaceKm,
  };
}
