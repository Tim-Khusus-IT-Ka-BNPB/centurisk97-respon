// A zip archive. Text parts are deflated, pictures are stored as they are: they hold no air to let
// out. Every file carries the same time, so the same files always make the same archive.

export type ZipFile = { readonly name: string; readonly bytes: Uint8Array; readonly deflate?: boolean };

const CRC = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function join(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export const utf8 = (text: string) => new TextEncoder().encode(text);

async function deflated(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// 1 January 1980, the first day the format can write.
const DATE = 0x21;
// The name is in UTF-8.
const FLAGS = 0x800;
const STORED = 0;
const DEFLATED = 8;

function header(signature: number, fields: readonly (readonly [size: 2 | 4, value: number])[]): Uint8Array {
  const view = new DataView(new ArrayBuffer(4 + fields.reduce((total, [size]) => total + size, 0)));
  view.setUint32(0, signature, true);
  let at = 4;
  for (const [size, value] of fields) {
    if (size === 2) view.setUint16(at, value, true);
    else view.setUint32(at, value, true);
    at += size;
  }
  return new Uint8Array(view.buffer);
}

export async function zip(files: readonly ZipFile[]): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;
  for (const { name, bytes, deflate = false } of files) {
    const label = utf8(name);
    const body = deflate ? await deflated(bytes) : bytes;
    const shared = [
      [2, 20],
      [2, FLAGS],
      [2, deflate ? DEFLATED : STORED],
      [2, 0],
      [2, DATE],
      [4, crc32(bytes)],
      [4, body.length],
      [4, bytes.length],
      [2, label.length],
      [2, 0],
    ] as const;
    const local = header(0x04034b50, shared);
    directory.push(header(0x02014b50, [[2, 20], ...shared, [2, 0], [2, 0], [2, 0], [4, 0], [4, offset]]), label);
    parts.push(local, label, body);
    offset += local.length + label.length + body.length;
  }
  const listing = join(directory);
  const end = header(0x06054b50, [
    [2, 0],
    [2, 0],
    [2, files.length],
    [2, files.length],
    [4, listing.length],
    [4, offset],
    [2, 0],
  ]);
  return join([...parts, listing, end]);
}
