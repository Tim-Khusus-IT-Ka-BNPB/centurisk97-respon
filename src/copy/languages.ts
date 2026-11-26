// The languages a reporter may pick (M05 TASK-001, upstream lapor_bahasa.js). The service, its data
// and the desk stay Indonesian: a language only changes the words of the report pages, from a file
// of its own in tr/, checked against the Indonesian one. No file, no choice. Names are Indonesian,
// so each is found by those who speak it ("bahasa batak gitu", owner, 20 Nov 2026).
export const LANGUAGES = [
  ["id", "Bahasa Indonesia"],
  ["jv", "Bahasa Jawa"],
  ["su", "Bahasa Sunda"],
  ["mad", "Bahasa Madura"],
  ["ban", "Bahasa Bali"],
  ["sas", "Bahasa Sasak"],
  ["min", "Bahasa Minang"],
  ["bbc", "Bahasa Batak Toba"],
  ["btx", "Bahasa Batak Karo"],
  ["btm", "Bahasa Batak Mandailing"],
  ["bts", "Bahasa Batak Simalungun"],
  ["nia", "Bahasa Nias"],
  ["ace", "Bahasa Aceh"],
  ["msa", "Bahasa Melayu"],
  ["ljp", "Bahasa Lampung"],
  ["bjn", "Bahasa Banjar"],
  ["nij", "Bahasa Dayak Ngaju"],
  ["bug", "Bahasa Bugis"],
  ["mak", "Bahasa Makassar"],
  ["sda", "Bahasa Toraja"],
  ["gor", "Bahasa Gorontalo"],
  ["abs", "Bahasa Ambon"],
  ["pmy", "Bahasa Papua"],
] as const;

export type LanguageId = (typeof LANGUAGES)[number][0];

type Translation = Readonly<Record<string, string>>;

const FILES = import.meta.glob<Translation>("./tr/*.json", { eager: true, import: "default" });

export const TRANSLATIONS: ReadonlyMap<string, Translation> = new Map(
  Object.entries(FILES).map(([path, words]) => [path.slice(5, -5), words]),
);

// Indonesian, and each language with a file.
export const OFFERED = LANGUAGES.filter(([id]) => id === "id" || TRANSLATIONS.has(id));

export const LANGUAGE_COOKIE = "bahasa";

// The language a browser picked, when it is still offered; Indonesian otherwise.
export function languageFrom(cookieHeader: string | null): LanguageId {
  const picked = /(?:^|;\s*)bahasa=([a-z]{2,3})(?:;|$)/.exec(cookieHeader ?? "")?.[1];
  return OFFERED.find(([id]) => id === picked)?.[0] ?? "id";
}
