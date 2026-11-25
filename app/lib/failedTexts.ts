import app from "../../src/copy/id/app.json";
import callNow from "../../src/copy/id/callNow.json";
import failed from "../../src/copy/id/failed.json";
import theme from "../../src/copy/id/theme.json";
import type { Texts } from "../../src/copy/text";

// The words of the page shown when a page cannot be. Every other page is handed its words by its
// loader; this one ships with the script, as the loader is what may have failed.
export const FAILED_TEXTS: Texts = { ...app, ...theme, ...callNow, ...failed };
