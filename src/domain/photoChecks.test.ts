import { describe, expect, test } from "vitest";
import { exifDateTime } from "../testing/jpegs";
import { cameraJpeg } from "../testing/photoBase";
import { readExif } from "./jpeg";
import {
  CHAT_PHOTO,
  type ChatPhotoInput,
  chatPhotoPlace,
  checkChatPhoto,
  checkPhoto,
  type DeviceFix,
  PHOTO,
  type PhotoInput,
} from "./photoChecks";

const NOW = Date.parse("2026-11-23T03:00:00.000Z");
const WIB = 420;
const HERE = { lat: -6.2, lon: 106.8 };
// About 6 km and 12 km north of HERE.
const SIX_KM = { lat: -6.146, lon: 106.8 };
const TWELVE_KM = { lat: -6.092, lon: 106.8 };
const fix = (extra: Partial<DeviceFix> = {}): DeviceFix => ({
  ...HERE,
  accuracyM: 30,
  readAtMs: NOW - 60_000,
  ...extra,
});

function input(exifValues: Parameters<typeof cameraJpeg>[0], extra: Partial<PhotoInput> = {}): PhotoInput {
  const bytes = cameraJpeg(exifValues);
  return {
    bytes,
    exif: readExif(bytes),
    nowMs: NOW,
    device: null,
    placePoint: HERE,
    count: 0,
    fallbackOffsetMinutes: WIB,
    ...extra,
  };
}

const camera = { make: "Uji", model: "Kamera" };
const justNow = exifDateTime(NOW - 30_000, WIB);

describe("photo checks", () => {
  test("a fresh camera photo with good device GPS is kept with the device badge and the camera time", () => {
    expect(checkPhoto(input({ ...camera, dateTime: justNow, offset: "+07:00" }, { device: fix() }))).toEqual({
      kind: "kept",
      badge: "deviceGps",
      point: HERE,
      accuracyM: 30,
      takenAtMs: NOW - 30_000,
      timeSource: "photoData",
      far: false,
    });
  });

  test("each rule refuses on its own, in the order of the table", () => {
    expect(checkPhoto(input({ dateTime: justNow }))).toEqual({ kind: "refused", rule: "notCamera" });
    expect(checkPhoto({ ...input({}), exif: null })).toEqual({ kind: "refused", rule: "notCamera" });
    expect(checkPhoto(input({ ...camera, dateTime: exifDateTime(NOW - 6 * 60_000, WIB) }))).toEqual({
      kind: "refused",
      rule: "notFresh",
    });
    expect(checkPhoto(input({ ...camera, dateTime: justNow, point: SIX_KM }, { device: fix() }))).toEqual({
      kind: "refused",
      rule: "farFromDevice",
    });
    expect(checkPhoto({ ...input(camera), bytes: new Uint8Array([0xff, 0xd8]) })).toEqual({
      kind: "refused",
      rule: "format",
    });
    expect(checkPhoto({ ...input(camera), bytes: new Uint8Array(2000) })).toEqual({ kind: "refused", rule: "format" });
    expect(checkPhoto(input(camera, { count: 10 }))).toEqual({ kind: "refused", rule: "tooMany" });
    // A screenshot taken long ago fails the first row only.
    expect(checkPhoto(input({ dateTime: exifDateTime(NOW - 3_600_000, WIB) }))).toEqual({
      kind: "refused",
      rule: "notCamera",
    });
    expect(checkPhoto(input({ ...camera, dateTime: exifDateTime(NOW - 3_600_000, WIB) }, { count: 10 }))).toEqual({
      kind: "refused",
      rule: "notFresh",
    });
  });

  test("a camera time with no offset is read in the fallback zone", () => {
    // Written on a WIB clock: read as WITA it is an hour older than it is.
    expect(checkPhoto(input({ ...camera, dateTime: justNow }, { fallbackOffsetMinutes: 480 }))).toEqual({
      kind: "refused",
      rule: "notFresh",
    });
    expect(checkPhoto(input({ ...camera, dateTime: justNow }))).toMatchObject({
      kind: "kept",
      takenAtMs: NOW - 30_000,
    });
  });

  test("with no usable device reading the photo's own place is the badge; with neither, no place", () => {
    expect(checkPhoto(input({ ...camera, point: HERE }))).toMatchObject({
      badge: "photoData",
      point: HERE,
      accuracyM: null,
    });
    expect(checkPhoto(input(camera, { device: fix({ accuracyM: 1500 }) }))).toMatchObject({
      badge: "none",
      point: null,
    });
    for (const device of [
      fix({ readAtMs: NOW - 11 * 60_000 }),
      fix({ readAtMs: NOW + 11 * 60_000 }),
      fix({ accuracyM: -1 }),
      fix({ accuracyM: Number.NaN }),
      fix({ lat: 40, lon: -3 }),
      fix({ lat: Number.NaN }),
    ])
      expect(checkPhoto(input({ ...camera, point: SIX_KM }, { device }))).toMatchObject({
        kind: "kept",
        badge: "photoData",
      });
    expect(checkPhoto(input({ ...camera, point: { lat: 40, lon: -3 } }))).toMatchObject({ badge: "none" });
  });

  test("time comes from the camera, else the device reading, else the upload, and a clock far ahead is not trusted", () => {
    expect(checkPhoto(input(camera, { device: fix() }))).toMatchObject({
      timeSource: "deviceGps",
      takenAtMs: NOW - 60_000,
    });
    expect(checkPhoto(input(camera))).toMatchObject({ timeSource: "upload", takenAtMs: NOW });
    expect(checkPhoto(input({ ...camera, dateTime: exifDateTime(NOW + 6 * 60_000, WIB) }))).toMatchObject({
      timeSource: "upload",
    });
    expect(checkPhoto(input({ ...camera, dateTime: exifDateTime(NOW + 4 * 60_000, WIB) }))).toMatchObject({
      timeSource: "photoData",
    });
  });

  test("a photo more than 10 km from the report's place is kept with the far badge", () => {
    expect(checkPhoto(input(camera, { device: fix({ ...TWELVE_KM }) }))).toMatchObject({ kind: "kept", far: true });
    expect(checkPhoto(input(camera, { device: fix({ ...SIX_KM }) }))).toMatchObject({ far: false });
    expect(checkPhoto(input(camera, { device: fix({ ...TWELVE_KM }), placePoint: null }))).toMatchObject({
      far: false,
    });
    expect(checkPhoto(input(camera))).toMatchObject({ far: false });
  });

  const jpegOf = (length: number) => {
    const bytes = new Uint8Array(length);
    bytes.set([0xff, 0xd8]);
    return bytes;
  };

  test("a file of exactly the smallest or the largest size is kept; a byte either side is refused", () => {
    for (const [length, kind] of [
      [PHOTO.minBytes - 1, "refused"],
      [PHOTO.minBytes, "kept"],
      [PHOTO.maxBytes, "kept"],
      [PHOTO.maxBytes + 1, "refused"],
    ] as const)
      expect(checkPhoto({ ...input(camera), bytes: jpegOf(length) }).kind, String(length)).toBe(kind);
  });

  test("a device reading on the edge of the box, of accuracy or of age is used; just past it is not", () => {
    const badge = (device: DeviceFix) => (checkPhoto(input(camera, { device })) as { badge: string }).badge;
    for (const [inside, outside] of [
      [{ lat: -12 }, { lat: -12.001 }],
      [{ lat: 7 }, { lat: 7.001 }],
      [{ lon: 94 }, { lon: 93.999 }],
      [{ lon: 142 }, { lon: 142.001 }],
      [{ accuracyM: 0 }, { accuracyM: -0.001 }],
      [{ accuracyM: 1000 }, { accuracyM: 1000.001 }],
      [{ readAtMs: NOW - 10 * 60_000 }, { readAtMs: NOW - 10 * 60_000 - 1 }],
    ]) {
      expect(badge(fix(inside)), JSON.stringify(inside)).toBe("deviceGps");
      expect(badge(fix(outside)), JSON.stringify(outside)).toBe("none");
    }
  });

  test("a photo point near the device reading is no refusal; the device point is the one kept", () => {
    const near = { lat: -6.21, lon: 106.8 };
    expect(checkPhoto(input({ ...camera, point: near }, { device: fix() }))).toMatchObject({
      kind: "kept",
      badge: "deviceGps",
      point: HERE,
    });
  });

  test("a camera time exactly five minutes old is fresh, and exactly five minutes ahead is trusted", () => {
    const at = (ms: number) =>
      checkPhoto({ ...input(camera), exif: { camera: true, point: null, time: { localMs: ms, offsetMinutes: 0 } } });
    expect(at(NOW - PHOTO.freshMs)).toMatchObject({ kind: "kept", timeSource: "photoData" });
    expect(at(NOW - PHOTO.freshMs - 1)).toEqual({ kind: "refused", rule: "notFresh" });
    expect(at(NOW + PHOTO.clockAheadMs)).toMatchObject({
      timeSource: "photoData",
      takenAtMs: NOW + PHOTO.clockAheadMs,
    });
    expect(at(NOW + PHOTO.clockAheadMs + 1)).toMatchObject({ timeSource: "upload" });
  });
});

describe("a photo sent in a chat", () => {
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const sent = (extra: Partial<ChatPhotoInput> = {}) =>
    checkChatPhoto({
      bytes: cameraJpeg({}),
      sentAtMs: NOW - MINUTE,
      nowMs: NOW,
      shared: null,
      placePoint: HERE,
      count: 0,
      ...extra,
    });

  test("with no location near it, it is kept without one, at its message's time", () => {
    expect(sent()).toEqual({
      kind: "kept",
      badge: "none",
      point: null,
      accuracyM: null,
      takenAtMs: NOW - MINUTE,
      timeSource: "chatMessage",
      far: false,
    });
  });

  test("a location shared up to 30 minutes before is its place", () => {
    expect(CHAT_PHOTO.locationMs).toBe(30 * MINUTE);
    expect(sent({ shared: { ...HERE, atMs: NOW - 30 * MINUTE } })).toMatchObject({
      badge: "chatLocation",
      point: HERE,
      accuracyM: null,
      far: false,
    });
    expect(sent({ shared: { ...HERE, atMs: NOW - 30 * MINUTE - 1 } })).toMatchObject({ badge: "none", point: null });
    expect(sent({ shared: { ...TWELVE_KM, atMs: NOW } })).toMatchObject({ badge: "chatLocation", far: true });
    expect(sent({ shared: { ...SIX_KM, atMs: NOW } })).toMatchObject({ badge: "chatLocation", far: false });
    expect(sent({ shared: { ...TWELVE_KM, atMs: NOW }, placePoint: null })).toMatchObject({ far: false });
  });

  test("a location shared after it places it the same way, and only the point is kept of it", () => {
    expect(chatPhotoPlace({ ...TWELVE_KM, atMs: NOW } as typeof TWELVE_KM, HERE)).toEqual({
      badge: "chatLocation",
      point: TWELVE_KM,
      far: true,
    });
  });

  test("a message time of the last 48 hours, up to five minutes ahead, is trusted", () => {
    const at = (sentAtMs: number) => sent({ sentAtMs });
    expect(at(NOW - 48 * HOUR + 1)).toMatchObject({ takenAtMs: NOW - 48 * HOUR + 1, timeSource: "chatMessage" });
    expect(at(NOW - 48 * HOUR)).toMatchObject({ takenAtMs: NOW, timeSource: "upload" });
    expect(at(NOW + 5 * MINUTE)).toMatchObject({ takenAtMs: NOW + 5 * MINUTE, timeSource: "chatMessage" });
    expect(at(NOW + 5 * MINUTE + 1)).toMatchObject({ takenAtMs: NOW, timeSource: "upload" });
  });

  test("not a JPEG, too small, too big, or one too many is refused", () => {
    const jpegOf = (length: number) => {
      const bytes = new Uint8Array(length);
      bytes.set(cameraJpeg({}).subarray(0, 900));
      return bytes;
    };
    const format = { kind: "refused", rule: "format" };
    expect(sent({ bytes: new Uint8Array(5000) })).toEqual(format);
    expect(sent({ bytes: jpegOf(PHOTO.minBytes - 1) })).toEqual(format);
    expect(sent({ bytes: jpegOf(PHOTO.minBytes) }).kind).toBe("kept");
    expect(CHAT_PHOTO.maxBytes).toBe(5 * 1024 * 1024);
    expect(sent({ bytes: jpegOf(CHAT_PHOTO.maxBytes) }).kind).toBe("kept");
    expect(sent({ bytes: jpegOf(CHAT_PHOTO.maxBytes + 1) })).toEqual(format);
    expect(sent({ count: PHOTO.maxPerDraft - 1 }).kind).toBe("kept");
    expect(sent({ count: PHOTO.maxPerDraft })).toEqual({ kind: "refused", rule: "tooMany" });
  });
});
