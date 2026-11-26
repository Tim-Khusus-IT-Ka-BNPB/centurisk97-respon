// Where photo and video files live. Only the services know a key; the platform picks the store.
export type PhotoStore = {
  put(key: string, bytes: Uint8Array): Promise<void>;
  // The file, or null when no file has this key.
  get(key: string): Promise<Uint8Array | null>;
  delete(keys: readonly string[]): Promise<void>;
  // A file sent in parts: opened, each part kept with its tag, made whole in order, or given up.
  startUpload(key: string, contentType: string): Promise<string>;
  uploadPart(key: string, uploadId: string, partNumber: number, bytes: Uint8Array): Promise<string>;
  completeUpload(key: string, uploadId: string, parts: readonly { partNumber: number; etag: string }[]): Promise<void>;
  abortUpload(key: string, uploadId: string): Promise<void>;
  // Part of a file and its whole size, or null when no file has this key.
  range(key: string, offset: number, length: number): Promise<{ bytes: Uint8Array; size: number } | null>;
};
