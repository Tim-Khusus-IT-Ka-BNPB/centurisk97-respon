import type { PhotoStore } from "../../ports/photoStore";

type Upload = {
  uploadPart(partNumber: number, value: Uint8Array): Promise<{ partNumber: number; etag: string }>;
  complete(parts: { partNumber: number; etag: string }[]): Promise<unknown>;
  abort(): Promise<void>;
};

// The R2 calls the store needs, so a test or a Node move can hand in another bucket.
export type Bucket = {
  put(key: string, value: Uint8Array, options: { httpMetadata: { contentType: string } }): Promise<unknown>;
  get(
    key: string,
    options?: { range: { offset: number; length: number } },
  ): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; size: number } | null>;
  delete(keys: string[]): Promise<void>;
  createMultipartUpload(key: string, options: { httpMetadata: { contentType: string } }): Promise<{ uploadId: string }>;
  resumeMultipartUpload(key: string, uploadId: string): Upload;
};

export function r2PhotoStore(bucket: Bucket): PhotoStore {
  return {
    async put(key, bytes) {
      await bucket.put(key, bytes, { httpMetadata: { contentType: "image/jpeg" } });
    },
    async get(key) {
      const found = await bucket.get(key);
      return found ? new Uint8Array(await found.arrayBuffer()) : null;
    },
    async delete(keys) {
      if (keys.length > 0) await bucket.delete([...keys]);
    },
    async startUpload(key, contentType) {
      return (await bucket.createMultipartUpload(key, { httpMetadata: { contentType } })).uploadId;
    },
    async uploadPart(key, uploadId, partNumber, bytes) {
      return (await bucket.resumeMultipartUpload(key, uploadId).uploadPart(partNumber, bytes)).etag;
    },
    async completeUpload(key, uploadId, parts) {
      await bucket.resumeMultipartUpload(key, uploadId).complete([...parts]);
    },
    async abortUpload(key, uploadId) {
      await bucket.resumeMultipartUpload(key, uploadId).abort();
    },
    async range(key, offset, length) {
      const found = await bucket.get(key, { range: { offset, length } });
      return found ? { bytes: new Uint8Array(await found.arrayBuffer()), size: found.size } : null;
    },
  };
}
