import type { S3Settings } from "./store.ts";

// An S3 bucket in memory, answering the calls the store makes the way S3 and Garage do: path-style
// keys, multipart uploads, byte ranges. Requests must be signed with the bucket's key. Local runs
// and tests with no S3 keep their files here, gone when the process ends; Garage takes the same
// calls in store.contract.test.ts.
export const MEMORY_S3: S3Settings = {
  endpoint: "http://memory.s3.invalid",
  region: "garage",
  bucket: "respon-files",
  accessKeyId: "GKmemorybucket0000000000000000",
  secretAccessKey: "the-key-of-the-bucket-in-memory-only",
};

type Upload = { readonly key: string; readonly parts: Map<number, Uint8Array> };

export function memoryBucket() {
  const objects = new Map<string, Uint8Array>();
  const uploads = new Map<string, Upload>();
  let uploadCount = 0;

  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const signed = request.headers.get("authorization") ?? "";
    if (!signed.startsWith("AWS4-HMAC-SHA256") || !signed.includes(`Credential=${MEMORY_S3.accessKeyId}/`))
      return new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 });
    const prefix = `/${MEMORY_S3.bucket}/`;
    if (!url.pathname.startsWith(prefix))
      return new Response("<Error><Code>NoSuchBucket</Code></Error>", { status: 404 });
    const key = url.pathname.slice(prefix.length).split("/").map(decodeURIComponent).join("/");
    const uploadId = url.searchParams.get("uploadId");
    const missing = () => new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 });

    if (request.method === "POST" && url.searchParams.has("uploads")) {
      uploadCount += 1;
      const id = `upload-${uploadCount}`;
      uploads.set(id, { key, parts: new Map() });
      return new Response(`<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);
    }
    if (uploadId !== null) {
      const upload = uploads.get(uploadId);
      if (upload === undefined || upload.key !== key)
        return new Response("<Error><Code>NoSuchUpload</Code></Error>", { status: 404 });
      if (request.method === "PUT") {
        const n = Number(url.searchParams.get("partNumber"));
        upload.parts.set(n, new Uint8Array(await request.arrayBuffer()));
        return new Response(null, { headers: { etag: `"etag-${n}"` } });
      }
      if (request.method === "DELETE") {
        uploads.delete(uploadId);
        return new Response(null, { status: 204 });
      }
      const asked = [
        ...(await request.text()).matchAll(/<PartNumber>(\d+)<\/PartNumber><ETag>&quot;etag-(\d+)&quot;<\/ETag>/g),
      ];
      if (asked.length === 0 || asked.some(([, n, tag]) => n !== tag || !upload.parts.has(Number(n))))
        return new Response("<Error><Code>InvalidPart</Code></Error>");
      const pieces = asked.map(([, n]) => upload.parts.get(Number(n)) as Uint8Array);
      const whole = new Uint8Array(pieces.reduce((total, piece) => total + piece.length, 0));
      let at = 0;
      for (const piece of pieces) {
        whole.set(piece, at);
        at += piece.length;
      }
      objects.set(key, whole);
      uploads.delete(uploadId);
      return new Response("<CompleteMultipartUploadResult><Key>done</Key></CompleteMultipartUploadResult>");
    }
    if (request.method === "PUT") {
      objects.set(key, new Uint8Array(await request.arrayBuffer()));
      return new Response(null);
    }
    if (request.method === "DELETE") {
      objects.delete(key);
      return new Response(null, { status: 204 });
    }
    const found = objects.get(key);
    if (found === undefined) return missing();
    const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.get("range") ?? "");
    if (range === null) return new Response(found as Uint8Array<ArrayBuffer>);
    const start = Number(range[1]);
    const end = Math.min(Number(range[2]), found.length - 1);
    return new Response(found.slice(start, end + 1) as Uint8Array<ArrayBuffer>, {
      status: 206,
      headers: { "content-range": `bytes ${start}-${end}/${found.length}` },
    });
  };

  return { fetcher: fetcher as typeof fetch, objects, uploads };
}
