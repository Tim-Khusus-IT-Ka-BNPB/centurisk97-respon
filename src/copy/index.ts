import { createCatalogue } from "./catalogue";

export { bannedWordHits, CopyError, createCatalogue } from "./catalogue";

// Every file of the Indonesian catalogue, bundled at build time.
export const copy = createCatalogue(import.meta.glob("./id/*.json", { eager: true, import: "default" }));
