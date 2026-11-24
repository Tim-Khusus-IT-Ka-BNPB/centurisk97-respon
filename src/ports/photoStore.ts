// Where photo files live. Only the services know a key; the platform picks the store.
export type PhotoStore = {
  put(key: string, bytes: Uint8Array): Promise<void>;
  // The file, or null when no file has this key.
  get(key: string): Promise<Uint8Array | null>;
  delete(keys: readonly string[]): Promise<void>;
};
