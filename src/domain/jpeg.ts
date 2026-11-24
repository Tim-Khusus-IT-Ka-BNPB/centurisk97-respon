// Reads what the photo checks need from a JPEG's own EXIF data, and strips every segment that
// can carry metadata before the file is stored (D11). Pure: bytes in, values out.
//
// Every read goes through one reader that refuses to read past the end, and every failure in
// here means a broken file, so a broken file has one outcome wherever it breaks: not readable.

import type { Point } from "./geo";

// The camera's clock as written in DateTimeOriginal, with its offset when OffsetTimeOriginal is there.
type ExifTime = { readonly localMs: number; readonly offsetMinutes: number | null };

export type Exif = {
  // Make or Model is set: upstream's whole test for "taken with a camera".
  readonly camera: boolean;
  readonly time: ExifTime | null;
  readonly point: Point | null;
};

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const APP1 = 0xe1;

const TAG = {
  make: 0x010f,
  model: 0x0110,
  exifIfd: 0x8769,
  gpsIfd: 0x8825,
  dateTimeOriginal: 0x9003,
  offsetTimeOriginal: 0x9011,
  gpsLatRef: 1,
  gpsLat: 2,
  gpsLonRef: 3,
  gpsLon: 4,
} as const;

const TYPE_ASCII = 2;
const TYPE_RATIONAL = 5;

// Reads bytes, and refuses any read outside them.
class Reader {
  constructor(readonly bytes: Uint8Array) {}
  byte(at: number): number {
    const value = this.bytes[at];
    if (value === undefined) throw new RangeError();
    return value;
  }
  u16(at: number, little = false): number {
    const [a, b] = [this.byte(at), this.byte(at + 1)];
    return little ? a | (b << 8) : (a << 8) | b;
  }
  u32(at: number, little: boolean): number {
    const [a, b] = [this.u16(at, little), this.u16(at + 2, little)];
    return little ? a + b * 0x10000 : a * 0x10000 + b;
  }
  slice(at: number, length: number): Uint8Array {
    this.byte(at + length - 1);
    return this.bytes.subarray(at, at + length);
  }
}

export const isJpeg = (bytes: Uint8Array): boolean => bytes[0] === 0xff && bytes[1] === SOI;

type Segment = { readonly marker: number; readonly start: number; readonly end: number };

class Broken extends Error {}

// The next segment from `at`, skipping fill bytes before its marker. A length under 2 makes the
// next segment start inside this one's length field, where no marker can be.
function segmentAt(reader: Reader, from: number): Segment {
  let at = from;
  if (reader.byte(at) !== 0xff) throw new Broken();
  while (reader.byte(at + 1) === 0xff) at += 1;
  const marker = reader.byte(at + 1);
  if (marker === EOI) return { marker, start: at, end: at + 2 };
  const length = reader.u16(at + 2);
  reader.byte(at + 1 + length);
  return { marker, start: at, end: at + 2 + length };
}

const EXIF_HEADER = "Exif\0\0";
const textOf = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

const isExif = (reader: Reader, segment: Segment) =>
  segment.marker === APP1 && textOf(reader.bytes.subarray(segment.start + 4, segment.start + 10)) === EXIF_HEADER;

// The EXIF segment among the header segments, before the first scan. A file with none has nothing
// to read, the same outcome as a broken one.
function exifSegment(reader: Reader): Segment {
  if (!isJpeg(reader.bytes)) throw new Broken();
  for (let at = 2; ; ) {
    const segment = segmentAt(reader, at);
    if (segment.marker === EOI) throw new Broken();
    if (isExif(reader, segment)) return segment;
    if (segment.marker === SOS) throw new Broken();
    at = segment.end;
  }
}

type Entry = { readonly type: number; readonly count: number; readonly at: number };

// The TIFF block inside the EXIF segment: offsets in it count from its start.
class Tiff {
  readonly little: boolean;
  constructor(readonly reader: Reader) {
    const order = textOf(reader.slice(0, 2));
    if (order !== "II" && order !== "MM") throw new Broken();
    this.little = order === "II";
    if (this.u16(2) !== 42) throw new Broken();
  }
  u16 = (at: number) => this.reader.u16(at, this.little);
  u32 = (at: number) => this.reader.u32(at, this.little);

  // Entries of the IFD at an offset, by tag.
  ifd(offset: number): Map<number, Entry> {
    const entries = new Map<number, Entry>();
    const count = this.u16(offset);
    for (let i = 0; i < count; i++) {
      const at = offset + 2 + i * 12;
      const type = this.u16(at + 2);
      const items = this.u32(at + 4);
      // A value over four bytes sits at the offset its field holds. Only text and rationals are read.
      const size = items * (type === TYPE_RATIONAL ? 8 : 1);
      entries.set(this.u16(at), { type, count: items, at: size > 4 ? this.u32(at + 8) : at + 8 });
    }
    return entries;
  }

  // An IFD pointed to by an entry of another, or none.
  child(entries: Map<number, Entry>, tag: number): Map<number, Entry> {
    const pointer = entries.get(tag);
    return pointer ? this.ifd(this.u32(pointer.at)) : new Map();
  }

  // Text without its terminating NULs, or null for an entry that is missing or not text.
  ascii(entry: Entry | undefined): string | null {
    if (entry?.type !== TYPE_ASCII) return null;
    return textOf(this.reader.slice(entry.at, entry.count)).replaceAll("\0", "").trim();
  }

  // Three rationals (degrees, minutes, seconds), or null for an entry that is missing or not that.
  rationals(entry: Entry | undefined): number[] | null {
    if (entry?.type !== TYPE_RATIONAL || entry.count !== 3) return null;
    // A zero denominator gives a value that is not finite, which the caller refuses.
    return [0, 1, 2].map((i) => this.u32(entry.at + i * 8) / this.u32(entry.at + i * 8 + 4));
  }
}

const DATE_TIME = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const OFFSET = /^([+-])(\d{2}):(\d{2})$/;

function timeOf(dateTime: string | null, offset: string | null): ExifTime | null {
  const parts = dateTime?.match(DATE_TIME);
  if (!parts) return null;
  const [, year, month, day, hour, minute, second] = parts;
  const written = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  const localMs = Date.parse(`${written}Z`);
  // A date the calendar rolls over (30 February, hour 24) does not read back as written.
  if (Number.isNaN(localMs) || new Date(localMs).toISOString().slice(0, 19) !== written) return null;
  const signed = offset?.match(OFFSET);
  const offsetMinutes = signed ? (signed[1] === "-" ? -1 : 1) * (Number(signed[2]) * 60 + Number(signed[3])) : null;
  return { localMs, offsetMinutes };
}

function coordinate(tiff: Tiff, gps: Map<number, Entry>, value: number, ref: number): number | null {
  const parts = tiff.rationals(gps.get(value));
  if (!parts?.every(Number.isFinite)) return null;
  const [degrees, minutes, seconds] = parts as [number, number, number];
  // A missing reference reads as north or east, as upstream reads it.
  const sign = ["S", "W"].includes(String(tiff.ascii(gps.get(ref)))) ? -1 : 1;
  return sign * (degrees + minutes / 60 + seconds / 3600);
}

function gpsPoint(tiff: Tiff, gps: Map<number, Entry>): Point | null {
  const lat = coordinate(tiff, gps, TAG.gpsLat, TAG.gpsLatRef);
  const lon = coordinate(tiff, gps, TAG.gpsLon, TAG.gpsLonRef);
  if (lat === null || lon === null) return null;
  // 0, 0 is what a phone writes with no fix.
  return lat === 0 && lon === 0 ? null : { lat, lon };
}

// The EXIF block of a JPEG, or null when the file has none or it does not parse.
export function readExif(bytes: Uint8Array): Exif | null {
  try {
    const reader = new Reader(bytes);
    const segment = exifSegment(reader);
    const tiff = new Tiff(new Reader(bytes.subarray(segment.start + 10, segment.end)));
    const first = tiff.ifd(tiff.u32(4));
    const exif = tiff.child(first, TAG.exifIfd);
    return {
      camera: Boolean(tiff.ascii(first.get(TAG.make)) || tiff.ascii(first.get(TAG.model))),
      time: timeOf(tiff.ascii(exif.get(TAG.dateTimeOriginal)), tiff.ascii(exif.get(TAG.offsetTimeOriginal))),
      point: gpsPoint(tiff, tiff.child(first, TAG.gpsIfd)),
    };
  } catch {
    return null;
  }
}

// Segments that carry the picture: frame and tables, restart interval, and the JFIF and Adobe
// headers decoders need. Everything else (EXIF, XMP, ICC, comments, maker data) is dropped.
function kept(reader: Reader, segment: Segment): boolean {
  const { marker } = segment;
  if (marker === SOS || marker === 0xdb || marker === 0xdd) return true;
  if (marker >= 0xc0 && marker <= 0xcf) return marker !== 0xc8;
  const name = textOf(reader.bytes.subarray(segment.start + 4, segment.start + 9));
  return (marker === 0xe0 && name === "JFIF\0") || (marker === 0xee && name === "Adobe");
}

const isRestart = (marker: number) => marker >= 0xd0 && marker <= 0xd7;

// Entropy-coded data runs to the next marker that is not a stuffed byte or a restart marker.
function scanEnd(reader: Reader, from: number): number {
  let at = from;
  for (;;) {
    if (reader.byte(at) === 0xff) {
      const next = reader.byte(at + 1);
      if (next !== 0 && !isRestart(next)) return at;
    }
    at += 1;
  }
}

// The JPEG with only the segments that draw it, cut after its end marker, or null when its
// structure is broken. The scans of a progressive file are walked one after another.
export function stripJpeg(bytes: Uint8Array): Uint8Array | null {
  const reader = new Reader(bytes);
  if (!isJpeg(bytes)) return null;
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  try {
    for (let at = 2; ; ) {
      const segment = segmentAt(reader, at);
      if (segment.marker === EOI) {
        parts.push(bytes.subarray(segment.start, segment.end));
        return join(parts);
      }
      if (kept(reader, segment)) parts.push(bytes.subarray(segment.start, segment.end));
      at = segment.end;
      if (segment.marker === SOS) {
        const end = scanEnd(reader, at);
        parts.push(bytes.subarray(at, end));
        at = end;
      }
    }
  } catch {
    return null;
  }
}

// A shrunk copy drawn on a canvas loses the camera's EXIF block, so the page puts the original's
// block back before it sends the copy: the server reads it there, then strips it before storing.
export function withExifOf(original: Uint8Array, copy: Uint8Array): Uint8Array {
  if (!isJpeg(copy)) return copy;
  let exif: Segment;
  try {
    exif = exifSegment(new Reader(original));
  } catch {
    // An original that is broken or has no block has none to carry over.
    return copy;
  }
  return join([copy.subarray(0, 2), original.subarray(exif.start, exif.end), copy.subarray(2)]);
}

function join(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
