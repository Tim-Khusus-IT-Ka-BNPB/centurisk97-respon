// Reads what the photo checks need from a JPEG's own EXIF data, and strips every segment that
// can carry metadata before the file is stored (D11). Pure: bytes in, values out.

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

export const isJpeg = (bytes: Uint8Array): boolean => bytes[0] === 0xff && bytes[1] === SOI;

type Segment = { readonly marker: number; readonly start: number; readonly end: number };

// The header segments in order, up to and including the first SOS, or null when they do not parse.
function headerSegments(bytes: Uint8Array): Segment[] | null {
  if (!isJpeg(bytes)) return null;
  const segments: Segment[] = [];
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1] as number;
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    const length = ((bytes[at + 2] as number) << 8) | (bytes[at + 3] as number);
    if (length < 2 || at + 2 + length > bytes.length) return null;
    segments.push({ marker, start: at, end: at + 2 + length });
    if (marker === SOS) return segments;
    at += 2 + length;
  }
  return null;
}

class Tiff {
  constructor(
    private readonly view: DataView,
    private readonly little: boolean,
  ) {}
  u16 = (at: number) => this.view.getUint16(at, this.little);
  u32 = (at: number) => this.view.getUint32(at, this.little);
  get size() {
    return this.view.byteLength;
  }
}

type Entry = { readonly type: number; readonly count: number; readonly valueAt: number };

// Entries of one IFD by tag. A value over four bytes sits at the offset its field holds.
function ifd(tiff: Tiff, offset: number): Map<number, Entry> {
  const entries = new Map<number, Entry>();
  if (offset + 2 > tiff.size) return entries;
  const count = tiff.u16(offset);
  for (let i = 0; i < count; i++) {
    const at = offset + 2 + i * 12;
    if (at + 12 > tiff.size) break;
    const type = tiff.u16(at + 2);
    const items = tiff.u32(at + 4);
    const bytes = items * (type === TYPE_RATIONAL ? 8 : type === 3 ? 2 : type === 4 ? 4 : 1);
    entries.set(tiff.u16(at), { type, count: items, valueAt: bytes > 4 ? tiff.u32(at + 8) : at + 8 });
  }
  return entries;
}

function ascii(tiff: Tiff, bytes: Uint8Array, entry: Entry | undefined): string | null {
  if (entry?.type !== TYPE_ASCII || entry.valueAt + entry.count > tiff.size) return null;
  const text = new TextDecoder().decode(bytes.subarray(entry.valueAt, entry.valueAt + entry.count));
  return text.replace(/\0+$/, "").trim();
}

function rationals(tiff: Tiff, entry: Entry | undefined): number[] | null {
  if (entry?.type !== TYPE_RATIONAL || entry.count !== 3 || entry.valueAt + 24 > tiff.size) return null;
  // A zero denominator gives a value that is not finite, which the caller refuses.
  return [0, 1, 2].map((i) => tiff.u32(entry.valueAt + i * 8) / tiff.u32(entry.valueAt + i * 8 + 4));
}

const DATE_TIME = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const OFFSET = /^([+-])(\d{2}):(\d{2})$/;

function timeOf(dateTime: string | null, offset: string | null): ExifTime | null {
  const parts = DATE_TIME.exec(dateTime ?? "")
    ?.slice(1)
    .map(Number);
  if (!parts) return null;
  const [year, month, day, hour, minute, second] = parts as [number, number, number, number, number, number];
  const localMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(localMs);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59)
    return null;
  const signed = OFFSET.exec(offset ?? "");
  const offsetMinutes = signed ? (signed[1] === "-" ? -1 : 1) * (Number(signed[2]) * 60 + Number(signed[3])) : null;
  return { localMs, offsetMinutes };
}

function coordinate(tiff: Tiff, bytes: Uint8Array, gps: Map<number, Entry>, value: number, ref: number): number | null {
  const parts = rationals(tiff, gps.get(value));
  if (!parts || parts.some((part) => !Number.isFinite(part))) return null;
  const [degrees, minutes, seconds] = parts as [number, number, number];
  // A missing reference reads as north or east, as upstream reads it.
  const sign = ["S", "W"].includes(String(ascii(tiff, bytes, gps.get(ref)))) ? -1 : 1;
  return sign * (degrees + minutes / 60 + seconds / 3600);
}

function gpsPoint(tiff: Tiff, bytes: Uint8Array, gps: Map<number, Entry>): Point | null {
  const lat = coordinate(tiff, bytes, gps, TAG.gpsLat, TAG.gpsLatRef);
  const lon = coordinate(tiff, bytes, gps, TAG.gpsLon, TAG.gpsLonRef);
  // 0, 0 is what a phone writes with no fix.
  if (lat === null || lon === null || (lat === 0 && lon === 0)) return null;
  return { lat, lon };
}

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0, 0];

// The EXIF block of a JPEG, or null when the file has none or it does not parse.
export function readExif(bytes: Uint8Array): Exif | null {
  const segments = headerSegments(bytes);
  const app1 = segments?.find(
    (segment) => segment.marker === APP1 && EXIF_HEADER.every((byte, i) => bytes[segment.start + 4 + i] === byte),
  );
  if (!app1) return null;
  const block = bytes.subarray(app1.start + 10, app1.end);
  const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
  if (block.length < 8) return null;
  const order = view.getUint16(0);
  if (order !== 0x4949 && order !== 0x4d4d) return null;
  const tiff = new Tiff(view, order === 0x4949);
  if (tiff.u16(2) !== 42) return null;
  const first = ifd(tiff, tiff.u32(4));
  const make = ascii(tiff, block, first.get(TAG.make));
  const model = ascii(tiff, block, first.get(TAG.model));
  const exifAt = first.get(TAG.exifIfd);
  const exif = exifAt ? ifd(tiff, tiff.u32(exifAt.valueAt)) : new Map<number, Entry>();
  const gpsAt = first.get(TAG.gpsIfd);
  const gps = gpsAt ? ifd(tiff, tiff.u32(gpsAt.valueAt)) : new Map<number, Entry>();
  return {
    camera: Boolean(make) || Boolean(model),
    time: timeOf(
      ascii(tiff, block, exif.get(TAG.dateTimeOriginal)),
      ascii(tiff, block, exif.get(TAG.offsetTimeOriginal)),
    ),
    point: gpsPoint(tiff, block, gps),
  };
}

// Segments that carry the picture: tables, frame, restart interval, and the JFIF and Adobe
// headers decoders need. Everything else (EXIF, XMP, ICC, comments, maker data) is dropped.
function kept(bytes: Uint8Array, segment: Segment): boolean {
  const { marker } = segment;
  if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc8) return true;
  if (marker === 0xdb || marker === 0xdd) return true;
  const name = new TextDecoder().decode(bytes.subarray(segment.start + 4, segment.start + 9));
  return (marker === 0xe0 && name === "JFIF\0") || (marker === 0xee && name.startsWith("Adobe"));
}

// A shrunk copy drawn on a canvas loses the camera's EXIF block, so the page puts the original's
// block back before it sends the copy: the server reads it there, then strips it before storing.
export function withExifOf(original: Uint8Array, copy: Uint8Array): Uint8Array {
  const exif = headerSegments(original)?.find(
    (segment) => segment.marker === APP1 && EXIF_HEADER.every((byte, i) => original[segment.start + 4 + i] === byte),
  );
  if (!exif || !isJpeg(copy)) return copy;
  return join([copy.subarray(0, 2), original.subarray(exif.start, exif.end), copy.subarray(2)]);
}

const isRestart = (marker: number) => marker >= 0xd0 && marker <= 0xd7;

// The JPEG with only the segments that draw it, cut after its end marker, or null when its
// structure is broken. The scans of a progressive file are walked one after another.
export function stripJpeg(bytes: Uint8Array): Uint8Array | null {
  if (!isJpeg(bytes)) return null;
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let at = 2;
  while (at + 1 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1] as number;
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === EOI) {
      parts.push(bytes.subarray(at, at + 2));
      return join(parts);
    }
    if (at + 4 > bytes.length) return null;
    const length = ((bytes[at + 2] as number) << 8) | (bytes[at + 3] as number);
    const segment = { marker, start: at, end: at + 2 + length };
    if (length < 2 || segment.end > bytes.length) return null;
    if (marker === SOS || kept(bytes, segment)) parts.push(bytes.subarray(segment.start, segment.end));
    at = segment.end;
    if (marker !== SOS) continue;
    // Entropy-coded data runs to the next marker that is not a stuffed byte or a restart marker.
    let scan = at;
    while (
      scan + 1 < bytes.length &&
      !(bytes[scan] === 0xff && bytes[scan + 1] !== 0 && !isRestart(bytes[scan + 1] as number))
    )
      scan += 1;
    parts.push(bytes.subarray(at, scan));
    at = scan;
  }
  return null;
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
