import { describe, expect, test } from "vitest";
import { checkVideo, containerOf, mp4Seconds, partBytes, partsOf, VIDEO } from "./video";

const MB = 1_048_576;
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));
const u32 = (value: number) => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
// An ftyp box of this brand, then a movie header of this version, scale and length.
function movie({ brand = "isom", version = 0, scale = 1000, units = 12_500, lead = 0 } = {}) {
  const ftyp = [...u32(16), ...ascii("ftyp"), ...ascii(brand), ...u32(0)];
  const times =
    version === 1
      ? [...u32(0), ...u32(0), ...u32(0), ...u32(0), ...u32(scale), ...u32(0), ...u32(units)]
      : [...u32(0), ...u32(0), ...u32(scale), ...u32(units)];
  const mvhd = [...u32(8 + 4 + times.length), ...ascii("mvhd"), version, 0, 0, 0, ...times];
  return new Uint8Array([...ftyp, ...new Array(lead).fill(0), ...mvhd]);
}
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]);

describe("a video's parts", () => {
  test("every part 5 MB but the last, which holds the rest", () => {
    expect([partsOf(1000), partsOf(5 * MB), partsOf(5 * MB + 1), partsOf(30 * MB)]).toEqual([1, 1, 2, 6]);
    expect([partBytes(12 * MB, 0), partBytes(12 * MB, 1), partBytes(12 * MB, 2)]).toEqual([5 * MB, 5 * MB, 2 * MB]);
    expect(partBytes(5 * MB, 0)).toBe(5 * MB);
    expect(VIDEO).toMatchObject({ maxBytes: 30 * MB, maxSeconds: 60, perReport: 3 });
  });
});

describe("a video's own bytes", () => {
  test("the container from its first bytes", () => {
    expect(containerOf(movie())).toBe("mp4");
    expect(containerOf(movie({ brand: "qt  " }))).toBe("mov");
    expect(containerOf(WEBM)).toBe("webm");
    expect(containerOf(new Uint8Array([0x1a, 0x45, 0xdf, 0xa4, ...new Array(8).fill(0)]))).toBeNull();
    expect(containerOf(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...ascii("ftyp"), 0, 0, 0, 0]))).toBe("mp4");
    expect(containerOf(new Uint8Array([0, 0, 0, 0, ...ascii("ftyq"), ...ascii("isom")]))).toBeNull();
    expect(containerOf(new Uint8Array([0, 0, 0, 0, ...ascii("ftyp"), 0, 0, 0]))).toBeNull();
    expect(containerOf(new Uint8Array([]))).toBeNull();
  });

  test("the length its movie header states, in either version, wherever it sits", () => {
    expect(mp4Seconds(movie())).toBe(12.5);
    expect(mp4Seconds(movie({ version: 1, scale: 600, units: 18_000 }))).toBe(30);
    expect(mp4Seconds(movie({ lead: 37 }))).toBe(12.5);
    expect(mp4Seconds(movie({ scale: 0 }))).toBeNull();
    expect(mp4Seconds(WEBM)).toBeNull();
    // A header cut short is no length.
    expect(mp4Seconds(movie().subarray(0, movie().length - 1))).toBeNull();
    expect(mp4Seconds(movie({ version: 1 }).subarray(0, movie({ version: 1 }).length - 1))).toBeNull();
  });
});

describe("a video made whole", () => {
  const whole = (extra: Partial<Parameters<typeof checkVideo>[0]> = {}) =>
    checkVideo({ head: movie(), tail: null, bytes: 5000, announcedBytes: 5000, browserSeconds: null, ...extra });

  test("an MP4 or MOV by its own length, from its start or its end; a WebM by the browser's", () => {
    expect(whole()).toEqual({ kind: "ok", container: "mp4", seconds: 13 });
    expect(whole({ head: movie().subarray(0, 16), tail: movie({ units: 61_000 }) })).toEqual({
      kind: "ok",
      container: "mp4",
      seconds: 61,
    });
    expect(whole({ head: WEBM, browserSeconds: 59.6 })).toEqual({ kind: "ok", container: "webm", seconds: 60 });
  });

  test("refused: not a video, a size not as announced, no length, or past 61 seconds", () => {
    expect(whole({ head: new Uint8Array([0xff, 0xd8, 0xff]) })).toEqual({ kind: "notVideo" });
    expect(whole({ bytes: 4999 })).toEqual({ kind: "sizeChanged" });
    expect(whole({ head: movie().subarray(0, 16) })).toEqual({ kind: "noLength" });
    expect(whole({ head: WEBM })).toEqual({ kind: "noLength" });
    expect(whole({ head: WEBM, browserSeconds: 61 })).toMatchObject({ kind: "ok", seconds: 61 });
    expect(whole({ head: WEBM, browserSeconds: 61.01 })).toEqual({ kind: "tooLong" });
    expect(whole({ head: movie({ units: 61_001 }) })).toEqual({ kind: "tooLong" });
  });
});
