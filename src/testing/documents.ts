// Reads back the files the document writers make, as a reader would: the words of a PDF and the
// parts of a Word file or a pack.

const latin1 = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

// Every line of text a PDF draws, in order.
export function pdfLines(bytes: Uint8Array): string[] {
  return [...latin1(bytes).matchAll(/\(((?:\\.|[^\\()])*)\) Tj/g)].map(([, text]) =>
    (text as string).replace(/\\(\d{3}|.)/g, (_, escaped: string) =>
      escaped.length === 3 ? String.fromCharCode(Number.parseInt(escaped, 8)) : escaped,
    ),
  );
}

// The words of a PDF as one line, so a sentence broken over lines is still found.
export const pdfText = (bytes: Uint8Array) => pdfLines(bytes).join(" ").replace(/\s+/g, " ");

async function inflated(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// The files of a zip by name, read from its directory at the end.
export async function unzipped(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  if (view.getUint32(end, true) !== 0x06054b50) throw new Error("Not a zip");
  const files = new Map<string, Uint8Array>();
  let at = view.getUint32(end + 16, true);
  for (let n = 0; n < view.getUint16(end + 10, true); n += 1) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("No directory entry");
    const deflated = view.getUint16(at + 10, true) === 8;
    const size = view.getUint32(at + 20, true);
    const length = view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + length));
    const local = view.getUint32(at + 42, true);
    if (view.getUint32(local, true) !== 0x04034b50) throw new Error("No local header");
    const start = local + 30 + view.getUint16(local + 26, true);
    const body = bytes.subarray(start, start + size);
    files.set(name, deflated ? await inflated(body) : body);
    at += 46 + length;
  }
  return files;
}

// The words of a Word file, paragraph by paragraph.
export async function docxText(bytes: Uint8Array): Promise<string> {
  const files = await unzipped(bytes);
  const xml = new TextDecoder().decode(files.get("word/document.xml"));
  return [...xml.matchAll(/<w:p>.*?<\/w:p>/g)]
    .map(([paragraph]) => [...paragraph.matchAll(/<w:t [^>]*>([^<]*)<\/w:t>/g)].map(([, text]) => text).join(""))
    .filter((text) => text !== "")
    .join(" ")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}
