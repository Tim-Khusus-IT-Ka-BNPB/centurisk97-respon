// A video upload a reload cut off (D89): which upload of this draft it was and how to know the file
// again when it is picked once more. Only the upload's id, the file's size and its modified time are
// kept, never its name or bytes, and only until the upload is whole or given up.
const KEY = "respon-video";

export type OpenUpload = { readonly id: string; readonly size: number; readonly modified: number };

type Kept = Readonly<Record<string, OpenUpload>>;

function read(): Kept {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return typeof stored === "object" && stored !== null && !Array.isArray(stored) ? (stored as Kept) : {};
  } catch {
    return {};
  }
}

function write(kept: Kept): void {
  try {
    if (Object.keys(kept).length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(kept));
  } catch {
    // Storage refused (private window, full): the upload starts over after a reload, as before.
  }
}

export const openUpload = (draftId: string): OpenUpload | null => read()[draftId] ?? null;

export const keepUpload = (draftId: string, upload: OpenUpload): void => write({ ...read(), [draftId]: upload });

export function dropUpload(draftId: string): void {
  const { [draftId]: _gone, ...rest } = read();
  write(rest);
}

// The same file picked again: its size and modified time match the upload that was cut off.
export const sameFile = (upload: OpenUpload, file: File): boolean =>
  upload.size === file.size && upload.modified === file.lastModified;
