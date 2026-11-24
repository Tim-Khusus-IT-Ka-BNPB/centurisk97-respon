import { describe, expect, test } from "vitest";
import { cameraJpeg } from "../testing/photoBase";
import { isJpeg, readExif, stripJpeg, withExifOf } from "./jpeg";

// Each case is one rule of the reader at its edge: the value just inside it and just outside.
const segment = (marker: number, body: number[]) => [
  0xff,
  marker,
  (body.length + 2) >> 8,
  (body.length + 2) & 0xff,
  ...body,
];
const ascii = (text: string) => [...new TextEncoder().encode(text)];
const SCAN = [...segment(0xda, [1, 0]), 0x12, 0xff, 0xd9];
const file = (...parts: number[][]) => new Uint8Array([0xff, 0xd8, ...parts.flat()]);

describe("isJpeg", () => {
  test("needs both bytes of the start marker", () => {
    expect(isJpeg(new Uint8Array([0xff, 0xd8]))).toBe(true);
    expect(isJpeg(new Uint8Array([0x00, 0xd8]))).toBe(false);
    expect(isJpeg(new Uint8Array([0xff, 0x00]))).toBe(false);
  });
});

describe("readExif at its edges", () => {
  test("a file whose start marker is wrong is not read, however good its EXIF block", () => {
    const photo = cameraJpeg({ make: "Uji" });
    photo[1] = 0xd9;
    expect(readExif(photo)).toBeNull();
  });

  test("an end marker before any scan, or no scan at all, is not readable", () => {
    expect(readExif(file([0xff, 0xd9]))).toBeNull();
    expect(readExif(file(segment(0xe0, ascii("JFIF\0"))))).toBeNull();
  });

  test("an APP1 that is XMP or misnamed is passed over; the EXIF one after it is read", () => {
    const exif = cameraJpeg({ make: "Uji" });
    const exifSegment = [...exif.subarray(2, 4 + ((exif[4] as number) << 8) + (exif[5] as number))];
    const xmp = segment(0xe1, ascii("http://ns.adobe.com/xap/1.0/\0<x/>"));
    const misnamed = segment(0xe1, ascii("Exif\0\x01MM"));
    expect(readExif(file(xmp, misnamed, exifSegment, SCAN))?.camera).toBe(true);
    expect(readExif(file(xmp, misnamed, SCAN))).toBeNull();
  });

  test("a byte order other than II or MM is not readable", () => {
    // Each block below parses but for the one thing named.
    const block = (order: string, magic: number) => [
      ...ascii("Exif\0\0"),
      ...ascii(order),
      0,
      magic,
      0,
      0,
      0,
      8,
      0,
      0,
      0,
      0,
      0,
      0,
    ];
    expect(readExif(file(segment(0xe1, block("MM", 42)), SCAN))).toEqual({ camera: false, time: null, point: null });
    expect(readExif(file(segment(0xe1, block("XX", 42)), SCAN))).toBeNull();
    expect(readExif(file(segment(0xe1, block("MM", 41)), SCAN))).toBeNull();
  });

  test("text short enough to sit inside its entry is read there; text of only NULs is no text", () => {
    expect(readExif(cameraJpeg({ make: "Uji" }))?.camera).toBe(true);
    expect(readExif(cameraJpeg({ model: "M" }))?.camera).toBe(true);
    expect(readExif(cameraJpeg({ make: "\0\0\0", model: "\0" }))?.camera).toBe(false);
  });

  test("text that runs past its block is not readable", () => {
    const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x0f, 0, 2, 0, 0, 0, 0x40, 0, 0, 0, 26, 0, 0, 0, 0];
    expect(readExif(file(segment(0xe1, [...ascii("Exif\0\0"), ...tiff]), SCAN))).toBeNull();
  });

  test("every part of the time must be on the calendar and clock", () => {
    for (const dateTime of [
      "2026:13:01 10:00:00",
      "2026:02:29 10:00:00",
      "2026:01:32 10:00:00",
      "2026:01:01 24:00:00",
      "2026:01:01 10:60:00",
      "2026:01:01 10:00:60",
    ])
      expect(readExif(cameraJpeg({ make: "U", dateTime }))?.time, dateTime).toBeNull();
    expect(readExif(cameraJpeg({ make: "U", dateTime: "2026:12:31 23:59:59" }))?.time?.localMs).toBe(
      Date.UTC(2026, 11, 31, 23, 59, 59),
    );
  });

  test("an offset with anything before or after it, or no time to go with, is not read", () => {
    for (const offset of ["x+07:00", "+07:00x", "+7:00"])
      expect(
        readExif(cameraJpeg({ make: "U", dateTime: "2026:01:01 10:00:00", offset }))?.time?.offsetMinutes,
        offset,
      ).toBeNull();
    expect(readExif(cameraJpeg({ make: "U", offset: "+07:00" }))?.time).toBeNull();
  });

  test("a point needs both coordinates; either may be 0, but not both", () => {
    expect(readExif(cameraJpeg({ make: "U", point: { lat: 0, lon: 97.5 } }))?.point).toEqual({ lat: 0, lon: 97.5 });
    expect(readExif(cameraJpeg({ make: "U", point: { lat: -6.5, lon: 0 } }))?.point).toEqual({ lat: -6.5, lon: 0 });
    expect(readExif(cameraJpeg({ make: "U", point: { lat: -6.5 } }))?.point).toBeNull();
    expect(readExif(cameraJpeg({ make: "U", point: { lon: 97.5 } }))?.point).toBeNull();
  });

  test("a latitude that is not three rationals is not a coordinate", () => {
    // IFD0 at 8 (18 bytes) points to the GPS IFD at 26 (30 bytes); the rationals sit at 56.
    // The latitude holds two rationals, and the longitude is written as text.
    const first = [0, 1, 0x88, 0x25, 0, 4, 0, 0, 0, 1, 0, 0, 0, 26, 0, 0, 0, 0];
    const gps = [0, 2, 0, 2, 0, 5, 0, 0, 0, 2, 0, 0, 0, 56, 0, 4, 0, 2, 0, 0, 0, 2, 0x45, 0, 0, 0, 0, 0, 0, 0];
    const rationals = [0, 0, 0, 6, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1];
    const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, ...first, ...gps, ...rationals];
    const exif = readExif(file(segment(0xe1, [...ascii("Exif\0\0"), ...tiff]), SCAN));
    expect(exif).toEqual({ camera: false, time: null, point: null });
  });
});

describe("stripJpeg at its edges", () => {
  const kept = (marker: number, body: number[]) => {
    const out = stripJpeg(file(segment(marker, body), SCAN)) as Uint8Array;
    return out.length > 2 + SCAN.length;
  };

  test("frame and table markers C0 to CF are kept except C8; DB and DD are kept, DC is not", () => {
    expect(kept(0xc0, [1])).toBe(true);
    expect(kept(0xcf, [1])).toBe(true);
    expect(kept(0xc8, [1])).toBe(false);
    expect(kept(0xbf, [1])).toBe(false);
    expect(kept(0xdb, [1])).toBe(true);
    expect(kept(0xdd, [1])).toBe(true);
    expect(kept(0xdc, [1])).toBe(false);
  });

  test("only APP0 named JFIF and APP14 named Adobe stay", () => {
    expect(kept(0xe0, ascii("JFIF\0"))).toBe(true);
    expect(kept(0xe0, ascii("JFXX\0"))).toBe(false);
    expect(kept(0xee, ascii("Adobe"))).toBe(true);
    expect(kept(0xee, ascii("Adobx"))).toBe(false);
    expect(kept(0xed, ascii("Adobe"))).toBe(false);
  });

  test("restart markers D0 to D7 stay inside a scan; D8 ends it", () => {
    const withRestarts = file([...segment(0xda, [1, 0]), 1, 0xff, 0xd0, 2, 0xff, 0xd7, 3, 0xff, 0xd9]);
    expect(stripJpeg(withRestarts)).toEqual(withRestarts);
    expect(stripJpeg(file([...segment(0xda, [1, 0]), 1, 0xff, 0xd8, 2, 0xff, 0xd9]))).toBeNull();
  });

  test("a scan or a segment that runs past the end of the file is refused", () => {
    expect(stripJpeg(file(segment(0xda, [1, 0]).slice(0, 5)))).toBeNull();
    expect(stripJpeg(file([...segment(0xda, [1, 0]), 1, 2]))).toBeNull();
    expect(stripJpeg(file([0xff]))).toBeNull();
    expect(stripJpeg(file([0xff, 0xdb, 0]))).toBeNull();
  });
});

describe("withExifOf at its edges", () => {
  test("an original that is broken, or not a JPEG, leaves the copy as it is", () => {
    const copy = stripJpeg(cameraJpeg({})) as Uint8Array;
    const broken = cameraJpeg({ make: "U" }).subarray(0, 30);
    expect(withExifOf(broken, copy)).toBe(copy);
    const notJpeg = cameraJpeg({ make: "U" });
    notJpeg[0] = 0;
    expect(withExifOf(notJpeg, copy)).toBe(copy);
  });
});

describe("each guard of the reader, on a file that only that guard refuses", () => {
  const exifOf = (photo: Uint8Array) => {
    const length = ((photo[4] as number) << 8) + (photo[5] as number);
    return [...photo.subarray(2, 4 + length)];
  };
  const EXIF = exifOf(cameraJpeg({ make: "Uji" }));

  test("a byte that is not FF where a marker should start is refused", () => {
    expect(readExif(file(EXIF, SCAN))?.camera).toBe(true);
    const shifted = file([0x12, ...EXIF.slice(1)], SCAN);
    expect(readExif(shifted)).toBeNull();
    expect(stripJpeg(shifted)).toBeNull();
  });

  test("an EXIF block cut short by one byte is not carried over", () => {
    const copy = stripJpeg(cameraJpeg({})) as Uint8Array;
    expect(withExifOf(file(EXIF), copy).length).toBe(copy.length + EXIF.length);
    expect(withExifOf(file(EXIF.slice(0, -1)), copy)).toBe(copy);
  });

  test("an EXIF block after the first scan is not read", () => {
    expect(readExif(file(segment(0xda, [1, 0]), EXIF))).toBeNull();
  });

  test("an end marker before the EXIF block hides it", () => {
    expect(readExif(file([0xff, 0xd9], EXIF, SCAN))).toBeNull();
  });

  test("an EXIF header in a segment other than APP1 is not EXIF", () => {
    expect(readExif(file([0xff, 0xe2, ...EXIF.slice(2)], SCAN))).toBeNull();
  });

  test("a date or time with anything around it is not read", () => {
    for (const dateTime of ["x2026:01:01 10:00:00", "2026:01:01 10:00:00x"])
      expect(readExif(cameraJpeg({ make: "U", dateTime }))?.time, dateTime).toBeNull();
  });

  test("a little-endian rational over 65535 reads whole", () => {
    // Seconds of this latitude are written as a numerator over 10,000, past 16 bits.
    const point = readExif(cameraJpeg({ make: "U", point: { lat: -6.123456, lon: 97.5 }, littleEndian: true }))?.point;
    expect(point?.lat).toBeCloseTo(-6.123456, 6);
  });

  test("only an APP0 named JFIF stays, not another segment of that name", () => {
    expect((stripJpeg(file(segment(0xe1, ascii("JFIF\0")), SCAN)) as Uint8Array).length).toBe(2 + SCAN.length);
  });

  test("a marker below the restart range ends a scan, so a C8 segment after it is dropped", () => {
    const scan = [...segment(0xda, [1, 0]), 7];
    expect([...(stripJpeg(file(scan, segment(0xc8, [1]), [0xff, 0xd9])) as Uint8Array)]).toEqual([
      0xff,
      0xd8,
      ...scan,
      0xff,
      0xd9,
    ]);
  });

  test("a file not starting with the start marker is not stripped, however good the rest", () => {
    const good = file(segment(0xe0, ascii("JFIF\0")), SCAN);
    expect(stripJpeg(good)).toEqual(good);
    good[0] = 0;
    expect(stripJpeg(good)).toBeNull();
  });

  test("bytes between two header segments are refused, not read as picture data", () => {
    expect(stripJpeg(file(segment(0xe0, ascii("JFIF\0")), [0x12, 0x34], SCAN))).toBeNull();
  });
});
