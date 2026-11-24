import type { PhotoStore } from "../../ports/photoStore";

// The R2 calls the store needs, so a test or a Node move can hand in another bucket.
export type Bucket = {
  put(key: string, value: Uint8Array, options: { httpMetadata: { contentType: string } }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(keys: string[]): Promise<void>;
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
  };
}
