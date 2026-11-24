// Synthetic camera photos: a base picture with an EXIF block holding exactly the values a test
// names. Big-endian TIFF, as many cameras write it. The unit tests pass the pinned base through
// photoBase.ts; the browser tests read the same file from disk.

export type ExifValues = {
  readonly make?: string;
  readonly model?: string;
  // "YYYY:MM:DD HH:MM:SS" on the camera's clock.
  readonly dateTime?: string;
  readonly offset?: string;
  // Either half may be left out, to write a GPS block that holds one coordinate only.
  readonly point?: { readonly lat?: number; readonly lon?: number };
  readonly littleEndian?: boolean;
};

type Field = { readonly tag: number; readonly type: number; readonly count: number; readonly data: Uint8Array };

const asciiField = (tag: number, text: string): Field => {
  const data = new TextEncoder().encode(`${text}\0`);
  return { tag, type: 2, count: data.length, data };
};

function rationalField(tag: number, value: number, little: boolean): Field {
  const degrees = Math.floor(value);
  const minutesAll = (value - degrees) * 60;
  const minutes = Math.floor(minutesAll);
  const seconds = Math.round((minutesAll - minutes) * 60 * 10_000);
  const data = new Uint8Array(24);
  const view = new DataView(data.buffer);
  [
    [degrees, 1],
    [minutes, 1],
    [seconds, 10_000],
  ].forEach(([numerator, denominator], i) => {
    view.setUint32(i * 8, numerator as number, little);
    view.setUint32(i * 8 + 4, denominator as number, little);
  });
  return { tag, type: 5, count: 3, data };
}

const pointerField = (tag: number): Field => ({ tag, type: 4, count: 1, data: new Uint8Array(4) });

// One IFD at `offset` of the TIFF block, its larger values after it. Returns its bytes.
function ifdBytes(
  fields: readonly Field[],
  offset: number,
  little: boolean,
  pointers: Map<number, number>,
): Uint8Array {
  const sorted = [...fields].sort((a, b) => a.tag - b.tag);
  const head = 2 + sorted.length * 12 + 4;
  const extra = sorted.reduce((total, field) => total + (field.data.length > 4 ? field.data.length : 0), 0);
  const out = new Uint8Array(head + extra);
  const view = new DataView(out.buffer);
  view.setUint16(0, sorted.length, little);
  let tail = head;
  sorted.forEach((field, i) => {
    const at = 2 + i * 12;
    view.setUint16(at, field.tag, little);
    view.setUint16(at + 2, field.type, little);
    view.setUint32(at + 4, field.count, little);
    const pointer = pointers.get(field.tag);
    if (pointer !== undefined) view.setUint32(at + 8, pointer, little);
    else if (field.data.length > 4) {
      view.setUint32(at + 8, offset + tail, little);
      out.set(field.data, tail);
      tail += field.data.length;
    } else out.set(field.data, at + 8);
  });
  return out;
}

function exifBlock(values: ExifValues): Uint8Array {
  const little = values.littleEndian ?? false;
  const first: Field[] = [];
  if (values.make !== undefined) first.push(asciiField(0x010f, values.make));
  if (values.model !== undefined) first.push(asciiField(0x0110, values.model));
  const exif: Field[] = [];
  if (values.dateTime !== undefined) exif.push(asciiField(0x9003, values.dateTime));
  if (values.offset !== undefined) exif.push(asciiField(0x9011, values.offset));
  const gps: Field[] = [];
  const { lat, lon } = values.point ?? {};
  if (lat !== undefined) gps.push(asciiField(1, lat < 0 ? "S" : "N"), rationalField(2, Math.abs(lat), little));
  if (lon !== undefined) gps.push(asciiField(3, lon < 0 ? "W" : "E"), rationalField(4, Math.abs(lon), little));
  if (exif.length > 0) first.push(pointerField(0x8769));
  if (gps.length > 0) first.push(pointerField(0x8825));
  // Lay out IFD0, then the EXIF IFD, then the GPS IFD, each pointer filled once its place is known.
  const firstSize = ifdBytes(
    first,
    8,
    little,
    new Map([
      [0x8769, 0],
      [0x8825, 0],
    ]),
  ).length;
  const exifAt = 8 + firstSize;
  const exifPart = exif.length > 0 ? ifdBytes(exif, exifAt, little, new Map()) : new Uint8Array();
  const gpsAt = exifAt + exifPart.length;
  const gpsPart = gps.length > 0 ? ifdBytes(gps, gpsAt, little, new Map()) : new Uint8Array();
  const firstPart = ifdBytes(
    first,
    8,
    little,
    new Map([
      [0x8769, exifAt],
      [0x8825, gpsAt],
    ]),
  );
  const tiff = new Uint8Array(8 + firstPart.length + exifPart.length + gpsPart.length);
  const view = new DataView(tiff.buffer);
  view.setUint16(0, little ? 0x4949 : 0x4d4d);
  view.setUint16(2, 42, little);
  view.setUint32(4, 8, little);
  tiff.set(firstPart, 8);
  tiff.set(exifPart, exifAt);
  tiff.set(gpsPart, gpsAt);
  return tiff;
}

// The base picture, which carries no metadata of its own, with an APP1 EXIF segment holding the
// values right after its SOI. No imports, so the browser tests use it from Node too.
export function withExif(base: Uint8Array, values: ExifValues = {}): Uint8Array {
  const tiff = exifBlock(values);
  const header = new TextEncoder().encode("Exif\0\0");
  const length = 2 + header.length + tiff.length;
  const app1 = new Uint8Array(2 + length);
  app1.set([0xff, 0xe1, length >> 8, length & 0xff]);
  app1.set(header, 4);
  app1.set(tiff, 4 + header.length);
  const out = new Uint8Array(base.length + app1.length);
  out.set(base.subarray(0, 2));
  out.set(app1, 2);
  out.set(base.subarray(2), 2 + app1.length);
  return out;
}

// "YYYY:MM:DD HH:MM:SS" for an instant on a clock `offsetMinutes` ahead of UTC.
export function exifDateTime(ms: number, offsetMinutes: number): string {
  const local = new Date(ms + offsetMinutes * 60_000).toISOString();
  return `${local.slice(0, 10).replaceAll("-", ":")} ${local.slice(11, 19)}`;
}
