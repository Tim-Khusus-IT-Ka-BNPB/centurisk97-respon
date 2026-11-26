// Answers that are the same for every reader, kept a short while at the data centre a reader
// reached, so a busy public page does not read the database for each of them.
export type EdgeCache = {
  // The kept text, or null when none is kept or it has run out.
  get(key: string): Promise<string | null>;
  put(key: string, text: string, seconds: number): Promise<void>;
};
