type Translation = Readonly<Record<string, string>>;

const FILES = import.meta.glob<Translation>("./tr/*.json", { eager: true, import: "default" });

// Each language's words, read on the server only.
export const TRANSLATIONS: ReadonlyMap<string, Translation> = new Map(
  Object.entries(FILES).map(([path, words]) => [path.slice(5, -5), words]),
);
