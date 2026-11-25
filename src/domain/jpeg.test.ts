import { describe, expect, test } from "vitest";
import { cameraJpeg, PHOTO_BASE } from "../testing/photoBase";
import { isJpeg, jpegSize, readExif, stripJpeg, withExifOf } from "./jpeg";

const segmentMarkers = (bytes: Uint8Array): number[] => {
  const markers: number[] = [];
  let at = 2;
  while (at + 4 <= bytes.length && bytes[at] === 0xff && bytes[at + 1] !== 0xda) {
    markers.push(bytes[at + 1] as number);
    at += 2 + (((bytes[at + 2] as number) << 8) | (bytes[at + 3] as number));
  }
  return markers;
};

const segment = (marker: number, body: number[]) => [
  0xff,
  marker,
  (body.length + 2) >> 8,
  (body.length + 2) & 0xff,
  ...body,
];

describe("readExif", () => {
  test("reads make, model, the camera time with its offset, and the GPS point", () => {
    const exif = readExif(
      cameraJpeg({
        make: "Uji",
        model: "Kamera 1",
        dateTime: "2026:11:23 10:00:05",
        offset: "+07:00",
        point: { lat: -6.2, lon: 106.8 },
      }),
    );
    expect(exif?.camera).toBe(true);
    expect(exif?.time).toEqual({ localMs: Date.UTC(2026, 10, 23, 10, 0, 5), offsetMinutes: 420 });
    expect(exif?.point?.lat).toBeCloseTo(-6.2, 5);
    expect(exif?.point?.lon).toBeCloseTo(106.8, 5);
  });

  test("reads a little-endian block, a negative offset and a west longitude", () => {
    const exif = readExif(
      cameraJpeg({
        model: "M",
        dateTime: "2026:01:31 23:59:59",
        offset: "-03:30",
        point: { lat: 1.5, lon: -2.25 },
        littleEndian: true,
      }),
    );
    expect(exif?.camera).toBe(true);
    expect(exif?.time?.offsetMinutes).toBe(-210);
    expect(exif?.point?.lon).toBeCloseTo(-2.25, 5);
  });

  test("a block with no make or model is not a camera, and its missing values are null", () => {
    expect(readExif(cameraJpeg({}))).toEqual({ camera: false, time: null, point: null });
    expect(readExif(cameraJpeg({ make: "   " }))?.camera).toBe(false);
  });

  test("a time that is not a calendar instant, or an offset of the wrong form, is not read", () => {
    expect(readExif(cameraJpeg({ make: "U", dateTime: "2026:02:30 10:00:00" }))?.time).toBeNull();
    expect(readExif(cameraJpeg({ make: "U", dateTime: "2026:02:28 24:00:00" }))?.time).toBeNull();
    expect(readExif(cameraJpeg({ make: "U", dateTime: "2026-02-28 10:00:00" }))?.time).toBeNull();
    expect(readExif(cameraJpeg({ make: "U", dateTime: "2026:02:28 10:00:00", offset: "+7" }))?.time).toEqual({
      localMs: Date.UTC(2026, 1, 28, 10),
      offsetMinutes: null,
    });
  });

  test("a GPS point of 0, 0 is a phone with no fix", () => {
    expect(readExif(cameraJpeg({ make: "U", point: { lat: 0, lon: 0 } }))?.point).toBeNull();
  });

  test("no EXIF segment, a file that is not a JPEG, or a broken block reads as null", () => {
    expect(
      readExif(new Uint8Array([0xff, 0xd8, ...segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]), 0xff, 0xda, 0, 2])),
    ).toBeNull();
    expect(readExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    const notTiff = [0x45, 0x78, 0x69, 0x66, 0, 0, 0x41, 0x41, 0, 42, 0, 0, 0, 8];
    expect(readExif(new Uint8Array([0xff, 0xd8, ...segment(0xe1, notTiff), 0xff, 0xda, 0, 2]))).toBeNull();
    const wrongMagic = [0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 41, 0, 0, 0, 8];
    expect(readExif(new Uint8Array([0xff, 0xd8, ...segment(0xe1, wrongMagic), 0xff, 0xda, 0, 2]))).toBeNull();
    const short = [0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d];
    expect(readExif(new Uint8Array([0xff, 0xd8, ...segment(0xe1, short), 0xff, 0xda, 0, 2]))).toBeNull();
    // A segment longer than the file, and bytes that are not a marker.
    expect(readExif(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x40, 0]))).toBeNull();
    expect(readExif(new Uint8Array([0xff, 0xd8, 0x00, 0xe1, 0, 4, 0, 0]))).toBeNull();
    expect(readExif(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 1, 0, 0]))).toBeNull();
  });

  test("an IFD that runs past its block is not readable; a value of another type is skipped", () => {
    // IFD0 claims two entries but the block ends after the first; its pointer to the EXIF IFD is out of range.
    const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 2, 0x87, 0x69, 0, 4, 0, 0, 0, 1, 0, 0, 0x40, 0];
    const exif = readExif(
      new Uint8Array([0xff, 0xd8, ...segment(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]), 0xff, 0xda, 0, 2]),
    );
    expect(exif).toBeNull();
    // Make written as a SHORT is not text; a GPS latitude with a zero denominator is not a number.
    const odd = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x0f, 0, 3, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0];
    expect(
      readExif(new Uint8Array([0xff, 0xd8, ...segment(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, ...odd]), 0xff, 0xda, 0, 2]))
        ?.camera,
    ).toBe(false);
  });

  test("an IFD whose offset is past the block is not readable", () => {
    const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0x10, 0];
    expect(
      readExif(
        new Uint8Array([0xff, 0xd8, ...segment(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]), 0xff, 0xda, 0, 2]),
      ),
    ).toBeNull();
  });

  test("a camera time with no offset keeps the offset unknown, and headers with no scan read as null", () => {
    expect(readExif(cameraJpeg({ make: "U", dateTime: "2026:02:28 10:00:00" }))?.time?.offsetMinutes).toBeNull();
    const exifOnly = cameraJpeg({ make: "U" }).subarray(0, 40);
    expect(
      readExif(new Uint8Array([...exifOnly.subarray(0, 2), ...segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0])])),
    ).toBeNull();
  });

  test("a GPS value with a zero denominator is not a point", () => {
    const photo = cameraJpeg({ make: "U", point: { lat: -6.2, lon: 106.8 } });
    // Zero the first denominator of the latitude: find its numerator 6 / 1 written big-endian.
    const needle = [0, 0, 0, 6, 0, 0, 0, 1];
    const at = photo.findIndex((_, i) => needle.every((byte, j) => photo[i + j] === byte));
    photo[at + 7] = 0;
    expect(readExif(photo)?.point).toBeNull();
  });

  test("padding bytes before a marker are skipped", () => {
    const bytes = cameraJpeg({ make: "U" });
    const padded = new Uint8Array([0xff, 0xd8, 0xff, ...bytes.subarray(2)]);
    expect(readExif(padded)?.camera).toBe(true);
  });
});

describe("stripJpeg", () => {
  test("keeps the picture and drops EXIF, comments and other application data", () => {
    const photo = cameraJpeg({ make: "Uji", model: "Kamera", point: { lat: -6.2, lon: 106.8 } });
    expect(segmentMarkers(photo)).toContain(0xe1);
    const stripped = stripJpeg(photo) as Uint8Array;
    expect(isJpeg(stripped)).toBe(true);
    expect(segmentMarkers(stripped)).not.toContain(0xe1);
    expect(readExif(stripped)).toBeNull();
    expect(stripped.subarray(-2)).toEqual(new Uint8Array([0xff, 0xd9]));
  });

  test("the pinned base picture carries no metadata of its own", () => {
    expect(stripJpeg(PHOTO_BASE)).toEqual(PHOTO_BASE);
  });

  test("bytes after the end marker are cut, restart markers and stuffed bytes stay in a scan, and a second scan is walked", () => {
    const tables = segment(0xdb, [0, 1, 2]);
    const scan = [...segment(0xda, [1, 0]), 0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56];
    const second = [...segment(0xc4, [9]), ...segment(0xda, [1, 0]), 0x78];
    const file = new Uint8Array([
      0xff,
      0xd8,
      ...segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1]),
      ...segment(0xee, [0x41, 0x64, 0x6f, 0x62, 0x65]),
      ...segment(0xfe, [0x68, 0x69]),
      ...segment(0xe2, [1]),
      ...tables,
      ...scan,
      ...second,
      0xff,
      0xd9,
      0xaa,
      0xbb,
    ]);
    expect([...(stripJpeg(file) as Uint8Array)]).toEqual([
      0xff,
      0xd8,
      ...segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1]),
      ...segment(0xee, [0x41, 0x64, 0x6f, 0x62, 0x65]),
      ...tables,
      ...scan,
      ...second,
      0xff,
      0xd9,
    ]);
  });

  test("an APP0 that is not JFIF is dropped", () => {
    const file = new Uint8Array([0xff, 0xd8, ...segment(0xe0, [0x4a, 0x46, 0x58, 0x58, 0]), 0xff, 0xff, 0xd9]);
    expect([...(stripJpeg(file) as Uint8Array)]).toEqual([0xff, 0xd8, 0xff, 0xd9]);
  });

  test("a broken structure is refused", () => {
    expect(stripJpeg(new Uint8Array([0x89, 0x50]))).toBeNull();
    expect(stripJpeg(new Uint8Array([0xff, 0xd8, 0x12, 0x34]))).toBeNull();
    expect(stripJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x40, 0x00, 1]))).toBeNull();
    expect(stripJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 1, 2]))).toBeNull();
    expect(stripJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xdb]))).toBeNull();
    // A scan that never ends.
    expect(stripJpeg(new Uint8Array([0xff, 0xd8, ...segment(0xda, [1]), 1, 2, 3]))).toBeNull();
  });
});

describe("withExifOf", () => {
  test("puts the original's EXIF block into a copy that lost it", () => {
    const original = cameraJpeg({ make: "Uji", point: { lat: -6.2, lon: 106.8 } });
    const copy = stripJpeg(original) as Uint8Array;
    expect(readExif(copy)).toBeNull();
    const restored = withExifOf(original, copy);
    expect(readExif(restored)).toEqual(readExif(original));
    expect(stripJpeg(restored)).toEqual(copy);
  });

  test("an original with no EXIF, or a copy that is not a JPEG, leaves the copy as it is", () => {
    const plain = stripJpeg(cameraJpeg({})) as Uint8Array;
    expect(withExifOf(plain, plain)).toBe(plain);
    const png = new Uint8Array([0x89, 0x50]);
    expect(withExifOf(cameraJpeg({ make: "U" }), png)).toBe(png);
  });
});

describe("the size of a picture", () => {
  // A frame header of this kind, in a file with a table before it.
  const framed = (marker: number, colours: number, height = 600, width = 800, before: number[] = []) =>
    Uint8Array.from([
      0xff,
      0xd8,
      0xff,
      0xdb,
      0,
      4,
      1,
      2,
      ...before,
      0xff,
      marker,
      0,
      11,
      8,
      height >> 8,
      height & 0xff,
      width >> 8,
      width & 0xff,
      colours,
      0,
      0,
      0,
      0xff,
      0xda,
      0,
      2,
      0xff,
      0xd9,
    ]);

  test("is read from the frame header, whatever its kind, past the tables before it", () => {
    for (const marker of [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc7, 0xc9, 0xcb, 0xcd, 0xcf])
      expect(jpegSize(framed(marker, 3)), marker.toString(16)).toEqual({ width: 800, height: 600, colours: 3 });
    expect(jpegSize(framed(0xc0, 1, 258, 515))).toEqual({ width: 515, height: 258, colours: 1 });
    // Huffman tables and arithmetic conditioning sit among the frame markers and are none.
    const tables = [0xff, 0xc4, 0, 11, 8, 0, 1, 0, 1, 3, 0, 0, 0, 0xff, 0xcc, 0, 11, 8, 0, 1, 0, 1, 3, 0, 0, 0];
    expect(jpegSize(framed(0xc2, 3, 600, 800, tables))).toEqual({ width: 800, height: 600, colours: 3 });
    expect(jpegSize(PHOTO_BASE)).toEqual({ width: expect.any(Number), height: expect.any(Number), colours: 3 });
  });

  test("none for a file with no frame before its scan or its end, a broken one, or another number of colours", () => {
    expect(jpegSize(framed(0xd0, 3))).toBeNull();
    expect(jpegSize(framed(0xbf, 3))).toBeNull();
    expect(jpegSize(framed(0xc8, 3))).toBeNull();
    expect(jpegSize(framed(0xc0, 4))).toBeNull();
    expect(jpegSize(framed(0xc0, 2))).toBeNull();
    expect(jpegSize(framed(0xc0, 3, 0, 800))).toBeNull();
    expect(jpegSize(framed(0xc0, 3, 600, 0))).toBeNull();
    expect(jpegSize(framed(0xc0, 3).subarray(0, 14))).toBeNull();
    expect(jpegSize(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9, ...framed(0xc0, 3).subarray(2)]))).toBeNull();
    expect(jpegSize(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2, ...framed(0xc0, 3).subarray(2)]))).toBeNull();
    expect(jpegSize(Uint8Array.from([1, 2, 3]))).toBeNull();
  });
});
