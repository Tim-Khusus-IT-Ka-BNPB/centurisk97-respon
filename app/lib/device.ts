import { withExifOf } from "../../src/domain/jpeg";
import { PHOTO } from "../../src/domain/photoChecks";

// What the phone itself can give: its position, and a camera photo made small enough to send.
// Script only; the forms work without either.

export type Position = {
  readonly lat: number;
  readonly lon: number;
  readonly accuracy: number;
  readonly readAt: number;
};

export type PositionResult =
  | { readonly kind: "read"; readonly position: Position }
  | { readonly kind: "denied" | "unavailable" | "unsupported" };

type Geolocation = Pick<globalThis.Geolocation, "getCurrentPosition">;

const once = (geo: Geolocation, options: PositionOptions) =>
  new Promise<GeolocationPosition>((resolve, reject) => geo.getCurrentPosition(resolve, reject, options));

const positionOf = (found: GeolocationPosition): Position => ({
  lat: found.coords.latitude,
  lon: found.coords.longitude,
  accuracy: found.coords.accuracy,
  readAt: found.timestamp,
});

// Upstream's reading: a fresh precise fix first; on anything but a refusal, once more with a
// rough fix up to 5 minutes old.
export async function readPosition(
  geo: Geolocation | undefined = globalThis.navigator?.geolocation,
): Promise<PositionResult> {
  if (!geo) return { kind: "unsupported" };
  try {
    return {
      kind: "read",
      position: positionOf(await once(geo, { enableHighAccuracy: true, maximumAge: 0, timeout: 12_000 })),
    };
  } catch (error) {
    if ((error as GeolocationPositionError).code === 1) return { kind: "denied" };
  }
  try {
    return {
      kind: "read",
      position: positionOf(await once(geo, { enableHighAccuracy: false, maximumAge: 300_000, timeout: 15_000 })),
    };
  } catch (error) {
    return { kind: (error as GeolocationPositionError).code === 1 ? "denied" : "unavailable" };
  }
}

// The fix sent with a photo: precise and fresh, or none.
export async function photoFix(
  geo: Geolocation | undefined = globalThis.navigator?.geolocation,
): Promise<Position | null> {
  if (!geo) return null;
  try {
    // A fresh fix is read now. WebKit's own timestamp is not always on the page's clock, and the
    // server compares the time with its own.
    const found = positionOf(await once(geo, { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 }));
    return { ...found, readAt: Date.now() };
  } catch {
    return null;
  }
}

const LONG_SIDE = 1280;
const QUALITIES = [0.72, 0.55, 0.4];

// A file the camera wrote more than 5 minutes ago is not a new photo (K75). The server checks the
// photo's own time; only the file's time is the page's to check.
export const isRecentFile = (file: File, nowMs: number) => nowMs - file.lastModified <= PHOTO.freshMs;

export type Shrink = (file: File) => Promise<Blob | null>;

// Upstream's shrink: the long side at most 1280 px, then the first quality under the size limit.
// A browser without these draws nothing, and the original is sent if it may be.
const canvasShrink: Shrink = async (file) => {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") return null;
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
  if (!bitmap) return null;
  const scale = Math.min(1, LONG_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of QUALITIES) {
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
    if (blob.size <= PHOTO.maxBytes) return blob;
  }
  return null;
};

// The photo to send: the shrunk copy carrying the original's EXIF block, or the original when it
// is already a JPEG under the limit and cannot be drawn; null when neither works.
export async function preparePhoto(file: File, shrink: Shrink = canvasShrink): Promise<Uint8Array | null> {
  const original = new Uint8Array(await file.arrayBuffer());
  const shrunk = await shrink(file);
  if (shrunk) return withExifOf(original, new Uint8Array(await shrunk.arrayBuffer()));
  return file.type === "image/jpeg" && original.length <= PHOTO.maxBytes ? original : null;
}
