import { afterEach, describe, expect, test, vi } from "vitest";
import { readExif } from "../../src/domain/jpeg";
import { PHOTO } from "../../src/domain/photoChecks";
import { cameraJpeg } from "../../src/testing/photoBase";
import { isRecentFile, photoFix, preparePhoto, readPosition } from "./device";

type Outcome = { readonly code: number } | { readonly lat: number };

// A geolocation that answers each call with the next outcome, and remembers the options asked for.
function geo(...outcomes: Outcome[]) {
  const asked: PositionOptions[] = [];
  return {
    asked,
    getCurrentPosition(ok: PositionCallback, fail?: PositionErrorCallback | null, options?: PositionOptions) {
      asked.push(options as PositionOptions);
      const next = outcomes.shift() as Outcome;
      if ("code" in next) fail?.({ code: next.code } as GeolocationPositionError);
      else ok({ coords: { latitude: next.lat, longitude: 97, accuracy: 12 }, timestamp: 1000 } as GeolocationPosition);
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("position", () => {
  test("a precise fix first, then a rough one on anything but a refusal", async () => {
    const one = geo({ lat: 5 });
    expect(await readPosition(one)).toEqual({
      kind: "read",
      position: { lat: 5, lon: 97, accuracy: 12, readAt: 1000 },
    });
    expect(one.asked).toEqual([{ enableHighAccuracy: true, maximumAge: 0, timeout: 12_000 }]);
    const two = geo({ code: 3 }, { lat: 6 });
    expect(await readPosition(two)).toMatchObject({ kind: "read", position: { lat: 6 } });
    expect(two.asked[1]).toEqual({ enableHighAccuracy: false, maximumAge: 300_000, timeout: 15_000 });
    expect(await readPosition(geo({ code: 1 }))).toEqual({ kind: "denied" });
    expect(await readPosition(geo({ code: 2 }, { code: 2 }))).toEqual({ kind: "unavailable" });
    expect(await readPosition(geo({ code: 2 }, { code: 1 }))).toEqual({ kind: "denied" });
    // Too slow twice is its own reason: the reporter moves somewhere open.
    expect(await readPosition(geo({ code: 3 }, { code: 3 }))).toEqual({ kind: "timeout" });
    expect(await readPosition(undefined)).toEqual({ kind: "unsupported" });
  });

  test("the photo fix is precise and fresh, or none", async () => {
    const one = geo({ lat: 5 });
    expect(await photoFix(one)).toMatchObject({ lat: 5, accuracy: 12 });
    expect(one.asked).toEqual([{ enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 }]);
    expect(await photoFix(geo({ code: 3 }))).toBeNull();
    expect(await photoFix(undefined)).toBeNull();
  });
});

describe("photo to send", () => {
  const jpeg = (bytes: Uint8Array, lastModified = Date.now()) =>
    new File([new Uint8Array(bytes)], "foto.jpg", { type: "image/jpeg", lastModified });

  test("a file written in the last 5 minutes is recent", () => {
    const now = Date.now();
    expect(isRecentFile(jpeg(new Uint8Array(1), now - PHOTO.freshMs), now)).toBe(true);
    expect(isRecentFile(jpeg(new Uint8Array(1), now - PHOTO.freshMs - 1), now)).toBe(false);
  });

  test("the shrunk copy carries the original's EXIF; with no copy a small JPEG goes as it is, anything else not at all", async () => {
    const original = cameraJpeg({ make: "Uji", point: { lat: 5.1, lon: 97 } });
    const copy = cameraJpeg({});
    const shrunk = await preparePhoto(jpeg(original), async () => new Blob([new Uint8Array(copy)]));
    expect(readExif(shrunk as Uint8Array)).toEqual(readExif(original));
    expect(await preparePhoto(jpeg(original), async () => null)).toEqual(original);
    const big = new Uint8Array(PHOTO.maxBytes + 1);
    expect(await preparePhoto(jpeg(big), async () => null)).toBeNull();
    const png = new File([new Uint8Array([0x89, 0x50])], "x.png", { type: "image/png" });
    expect(await preparePhoto(png, async () => null)).toBeNull();
  });

  test("the canvas draws at most 1280 px on the long side and takes the first quality under the limit", async () => {
    const drawn: number[][] = [];
    const qualities: number[] = [];
    const sizes = [PHOTO.maxBytes + 1, 1000];
    vi.stubGlobal("createImageBitmap", async () => ({ width: 4000, height: 3000, close: () => {} }));
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(
          readonly width: number,
          readonly height: number,
        ) {
          drawn.push([width, height]);
        }
        getContext() {
          return { drawImage: () => {} };
        }
        async convertToBlob(options: { quality: number }) {
          qualities.push(options.quality);
          return new Blob([new Uint8Array(sizes.shift() as number)]);
        }
      },
    );
    const sent = await preparePhoto(jpeg(cameraJpeg({ make: "U" })));
    expect(drawn).toEqual([[1280, 960]]);
    expect(qualities).toEqual([0.72, 0.55]);
    expect(sent?.length).toBe(1000);
  });

  test("a picture the canvas cannot draw or shrink enough is not drawn", async () => {
    const original = cameraJpeg({ make: "U" });
    // This test browser has no canvas drawing at all.
    expect(await preparePhoto(jpeg(original))).toEqual(original);
    vi.stubGlobal("createImageBitmap", async () => {
      throw new Error("not an image");
    });
    vi.stubGlobal("OffscreenCanvas", class {});
    expect(await preparePhoto(jpeg(original))).toEqual(original);
    vi.stubGlobal("createImageBitmap", async () => ({ width: 100, height: 50, close: () => {} }));
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        width = 100;
        height = 50;
        getContext() {
          return null;
        }
        async convertToBlob() {
          return new Blob([new Uint8Array(PHOTO.maxBytes + 1)]);
        }
      },
    );
    expect(await preparePhoto(jpeg(original))).toEqual(original);
  });
});
