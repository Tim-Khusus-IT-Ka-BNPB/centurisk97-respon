import base from "../../db/synthetic/photo-base.jpg?inline";
import { type ExifValues, withExif } from "./jpegs";

// The pinned synthetic picture, as bytes, for unit tests.
export const PHOTO_BASE = Uint8Array.from(atob(base.slice(base.indexOf(",") + 1)), (char) => char.charCodeAt(0));

export const cameraJpeg = (values: ExifValues = {}): Uint8Array => withExif(PHOTO_BASE, values);
