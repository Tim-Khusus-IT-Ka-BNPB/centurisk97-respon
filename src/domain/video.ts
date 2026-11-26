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

export type VideoRefusal = "notVideo" | "noLength" | "tooLong" | "sizeChanged";

// A video made whole: its container, its length (read from it, or the browser's for a WebM), and
// its size as announced.
export function checkVideo(input: {
  readonly head: Uint8Array;
  readonly tail: Uint8Array | null;
  readonly bytes: number;
  readonly announcedBytes: number;
  readonly browserSeconds: number | null;
}): { readonly kind: "ok"; readonly container: Container; readonly seconds: number } | { readonly kind: VideoRefusal } {
  const container = containerOf(input.head);
  if (container === null) return { kind: "notVideo" };
  if (input.bytes !== input.announcedBytes) return { kind: "sizeChanged" };
  const read = mp4Seconds(input.head) ?? (input.tail === null ? null : mp4Seconds(input.tail));
  const seconds = container === "webm" ? input.browserSeconds : read;
  if (seconds === null) return { kind: "noLength" };
  if (seconds > VIDEO.maxSeconds + 1) return { kind: "tooLong" };
  return { kind: "ok", container, seconds: Math.round(seconds) };
}
