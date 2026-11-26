import { inIndonesia, type Point } from "./geo";
// A video of the scene (M05 TASK-003, upstream D77, D79, D89, D90): sent in parts over a multipart
// upload, so a broken line continues where it stopped, and checked by its own bytes once whole.

export const VIDEO = {
  // Every part but the last is exactly this size, as the store requires.
  partBytes: 5 * 1_048_576,
  minBytes: 1000,
  maxBytes: 30 * 1_048_576,
  maxSeconds: 60,
  perReport: 3,
  // Uploads open at once on one draft.
  openUploads: 2,
  // How much of each end is read for the container's header.
  sideBytes: 1_048_576,
} as const;

export type Container = "mp4" | "mov" | "webm";

export const partsOf = (bytes: number) => Math.ceil(bytes / VIDEO.partBytes);

// The size part n (from 0) must have.
export const partBytes = (bytes: number, n: number) =>
  n === partsOf(bytes) - 1 ? bytes - n * VIDEO.partBytes : VIDEO.partBytes;

const text = (bytes: Uint8Array, at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));

// The container from its first bytes, never from a name or a type the browser gave.
const EBML = [0x1a, 0x45, 0xdf, 0xa3];

export function containerOf(head: Uint8Array): Container | null {
  if (EBML.every((byte, at) => head[at] === byte)) return "webm";
  if (head.length < 12 || text(head, 4, 4) !== "ftyp") return null;
  return text(head, 8, 4) === "qt  " ? "mov" : "mp4";
}

// The length in seconds an MP4 or MOV states in its movie header (mvhd), or null when the bytes
// hold none. Version 1 keeps its times in 64 bits.
export function mp4Seconds(bytes: Uint8Array): number | null {
  // One byte, one character: the header's place in the text is its place in the bytes.
  const at = new TextDecoder("latin1").decode(bytes).indexOf("mvhd");
  if (at < 0) return null;
  const wide = bytes[at + 4] === 1;
  if (at + (wide ? 36 : 24) > bytes.length) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const scale = view.getUint32(at + (wide ? 24 : 16));
  const units = wide ? Number(view.getBigUint64(at + 28)) : view.getUint32(at + 20);
  return scale === 0 ? null : units / scale;
}

// Seconds from 1904, an MP4's epoch, to 1970.
const MP4_EPOCH_S = 2_082_844_800;

// When the movie header (mvhd) says it was made, as a phone writes it, or null when it holds none.
export function mp4Created(bytes: Uint8Array): number | null {
  const at = new TextDecoder("latin1").decode(bytes).indexOf("mvhd");
  if (at < 0) return null;
  const wide = bytes[at + 4] === 1;
  if (at + (wide ? 16 : 12) > bytes.length) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const seconds = wide ? Number(view.getBigUint64(at + 8)) : view.getUint32(at + 8);
  return seconds === 0 ? null : (seconds - MP4_EPOCH_S) * 1000;
}

// Where a phone says it was made: an ISO 6709 point ("+05.1470+097.0482/"), as Android writes it
// in ©xyz and an iPhone under its location key. Only a point in Indonesia's box is taken.
const ISO6709 = /([+-]\d{1,2}\.\d{2,})([+-]\d{1,3}\.\d{2,})/;

export function mp4Place(bytes: Uint8Array): Point | null {
  const found = ISO6709.exec(new TextDecoder("latin1").decode(bytes));
  if (found === null) return null;
  const point = { lat: Number(found[1]), lon: Number(found[2]) };
  return inIndonesia(point) ? point : null;
}

export type VideoRefusal = "notVideo" | "noLength" | "tooLong" | "sizeChanged";

// A video made whole: its container, its length (read from it, or the browser's for a WebM), and
// its size as announced.
export function checkVideo(input: {
  readonly head: Uint8Array;
  readonly tail: Uint8Array | null;
  readonly bytes: number;
  readonly announcedBytes: number;
  readonly browserSeconds: number | null;
}):
  | {
      readonly kind: "ok";
      readonly container: Container;
      readonly seconds: number;
      // When and where the file says it was made; null when it says nothing believable.
      readonly createdMs: number | null;
      readonly point: Point | null;
    }
  | { readonly kind: VideoRefusal } {
  const container = containerOf(input.head);
  if (container === null) return { kind: "notVideo" };
  if (input.bytes !== input.announcedBytes) return { kind: "sizeChanged" };
  const read = mp4Seconds(input.head) ?? (input.tail === null ? null : mp4Seconds(input.tail));
  const seconds = container === "webm" ? input.browserSeconds : read;
  if (seconds === null) return { kind: "noLength" };
  if (seconds > VIDEO.maxSeconds + 1) return { kind: "tooLong" };
  const side = (read: (bytes: Uint8Array) => unknown) =>
    read(input.head) ?? (input.tail === null ? null : read(input.tail));
  return {
    kind: "ok",
    container,
    seconds: Math.round(seconds),
    createdMs: side(mp4Created) as number | null,
    point: side(mp4Place) as Point | null,
  };
}
