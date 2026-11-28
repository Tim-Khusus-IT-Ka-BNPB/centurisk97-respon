import { AwsClient } from "aws4fetch";
import type { Settings } from "../../platform/settings.ts";
import type { PhotoStore } from "../../ports/photoStore.ts";

// Where the files live: Garage on the server (decision 0015 in centurisk97-platform), or any S3
// that takes path-style requests. A paid provider later is a change of these settings only.
export type S3Settings = NonNullable<Settings["s3"]>;

const xmlValue = (xml: string, tag: string) => new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)?.[1] ?? null;

const escaped = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

async function ok(response: Response, what: string): Promise<Response> {
  if (response.ok) return response;
  // The body may name the bucket or the key; only the status leaves.
  await response.body?.cancel();
  throw new Error(`s3.${what}: ${response.status}`);
}

export function s3PhotoStore(settings: S3Settings, fetcher: typeof fetch = fetch): PhotoStore {
  const client = new AwsClient({
    accessKeyId: settings.accessKeyId,
    secretAccessKey: settings.secretAccessKey,
    service: "s3",
    region: settings.region,
  });
  const base = `${settings.endpoint.replace(/\/$/, "")}/${encodeURIComponent(settings.bucket)}`;
  const urlOf = (key: string, query: Record<string, string> = {}) => {
    const url = new URL(`${base}/${key.split("/").map(encodeURIComponent).join("/")}`);
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    return url.href;
  };
  const send = async (url: string, init: RequestInit = {}) => fetcher(await client.sign(url, init));

  return {
    async put(key, bytes) {
      await ok(
        await send(urlOf(key), {
          method: "PUT",
          body: bytes as Uint8Array<ArrayBuffer>,
          headers: { "content-type": "image/jpeg" },
        }),
        "put",
      );
    },
    async get(key) {
      const response = await send(urlOf(key));
      if (response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      return new Uint8Array(await (await ok(response, "get")).arrayBuffer());
    },
    async delete(keys) {
      // One request each: S3 answers a delete of a missing key as done, so a retried sweep is harmless.
      await Promise.all(keys.map(async (key) => ok(await send(urlOf(key), { method: "DELETE" }), "delete")));
    },
    async startUpload(key, contentType) {
      const response = await ok(
        await send(urlOf(key, { uploads: "" }), { method: "POST", headers: { "content-type": contentType } }),
        "startUpload",
      );
      const uploadId = xmlValue(await response.text(), "UploadId");
      if (uploadId === null) throw new Error("s3.startUpload: no upload id");
      return uploadId;
    },
    async uploadPart(key, uploadId, partNumber, bytes) {
      const response = await ok(
        await send(urlOf(key, { partNumber: String(partNumber), uploadId }), {
          method: "PUT",
          body: bytes as Uint8Array<ArrayBuffer>,
        }),
        "uploadPart",
      );
      await response.body?.cancel();
      return response.headers.get("etag") ?? "";
    },
    async completeUpload(key, uploadId, parts) {
      const body = `<CompleteMultipartUpload>${parts
        .map((part) => `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${escaped(part.etag)}</ETag></Part>`)
        .join("")}</CompleteMultipartUpload>`;
      const response = await ok(
        await send(urlOf(key, { uploadId }), {
          method: "POST",
          body,
          headers: { "content-type": "application/xml" },
        }),
        "completeUpload",
      );
      // S3 may answer 200 and still name an error in the body.
      if (xmlValue(await response.text(), "Code") !== null) throw new Error("s3.completeUpload: refused");
    },
    async abortUpload(key, uploadId) {
      const response = await send(urlOf(key, { uploadId }), { method: "DELETE" });
      // An upload already gone is given up all the same.
      if (response.status !== 404) await ok(response, "abortUpload");
      await response.body?.cancel();
    },
    async range(key, offset, length) {
      const response = await send(urlOf(key), { headers: { range: `bytes=${offset}-${offset + length - 1}` } });
      if (response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      const partial = await ok(response, "range");
      const size = Number(/\/(\d+)$/.exec(partial.headers.get("content-range") ?? "")?.[1] ?? Number.NaN);
      const bytes = new Uint8Array(await partial.arrayBuffer());
      return { bytes, size: Number.isNaN(size) ? bytes.length : size };
    },
  };
}
