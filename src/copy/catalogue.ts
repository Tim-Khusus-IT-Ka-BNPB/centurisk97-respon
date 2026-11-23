// The copy catalogue: flat files of full dot keys to Indonesian text with {param} placeholders.
// Code holds keys only. A missing key or a missing param fails loudly, never shows a raw key.
type CopyParams = Readonly<Record<string, string | number>>;

export class CopyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CopyError";
  }
}

export type Catalogue = {
  readonly keys: readonly string[];
  has(key: string): boolean;
  text(key: string): string;
  format(key: string, params?: CopyParams): string;
};

const PLACEHOLDER = /\{(\w+)\}/g;
const numbers = new Intl.NumberFormat("id-ID");

export function createCatalogue(files: Readonly<Record<string, unknown>>): Catalogue {
  const entries = new Map<string, string>();
  for (const [file, content] of Object.entries(files)) {
    if (typeof content !== "object" || content === null || Array.isArray(content)) {
      throw new CopyError(`Copy file ${file} is not one flat object`);
    }
    for (const [key, value] of Object.entries(content)) {
      if (typeof value !== "string") throw new CopyError(`Copy key ${key} in ${file} is not text`);
      if (entries.has(key)) throw new CopyError(`Copy key ${key} is defined twice`);
      entries.set(key, value);
    }
  }
  const text = (key: string) => {
    const value = entries.get(key);
    if (value === undefined) throw new CopyError(`Copy key ${key} is missing`);
    return value;
  };
  return {
    keys: [...entries.keys()].sort(),
    has: (key) => entries.has(key),
    text,
    format: (key, params = {}) =>
      text(key).replace(PLACEHOLDER, (_match, name: string) => {
        const value = params[name];
        if (value === undefined) throw new CopyError(`Copy key ${key} needs param ${name}`);
        // Counts use the Indonesian thousands dot ("2.000").
        return typeof value === "number" ? numbers.format(value) : value;
      }),
  };
}

// The product never says an area is safe (hard failure 6). Matched as a whole word only, so
// words such as "halaman" or "tanaman" stay.
const BANNED_SAFETY_WORD = /(?<![\p{L}\p{N}])aman(?![\p{L}\p{N}])/iu;

export function bannedWordHits(catalogue: Catalogue): readonly string[] {
  return catalogue.keys.filter((key) => BANNED_SAFETY_WORD.test(catalogue.text(key)));
}
