// What a language file may change: the report pages' words, and nothing a reporter relies on. No
// imports, so the translation tool shares these rules.

// The catalogue namespaces the report pages draw from (start, draft, chronology).
export const TRANSLATED = [
  "app.",
  "page.",
  "meta.",
  "notice.",
  "common.",
  "help.title",
  "nav.",
  "home.contact.organisation",
  "home.report",
  "theme.",
  "about.steps.title",
  "about.step",
  "about.words.",
  "emergency.start",
  "emergency.startLead",
  "identity.",
  "consent.",
  "known.",
  "resume.",
  "start.",
  "card.",
  "chat.",
  "chronology.",
  "error.",
  "fieldError.",
  "field.",
  "followUp.",
  "group.",
  "hazard.",
  "hazardSubtype.",
  "limit.",
  "option.",
  "privacy.",
  "refusal.",
  "reply.",
  "stage.",
  "state.",
  "unit.",
  "value.",
  "version.change",
] as const;

// app.lang names the file's language and is never translated.
export const isTranslated = (key: string) => key !== "app.lang" && TRANSLATED.some((prefix) => key.startsWith(prefix));

const placeholders = (text: string) => [...text.matchAll(/\{[a-zA-Z]+\}/g)].map((found) => found[0]).sort();
const digits = (text: string) => [...text.matchAll(/\d+(?:[.,]\d+)*/g)].map((found) => found[0]).sort();
const SAFE = /(?<![\p{L}\p{N}])aman(?![\p{L}\p{N}])/iu;

// Why a translation of one line is refused, or null. Every placeholder and every number stays as
// it was, both ways (upstream lapor_bahasa.js, D81); a line far longer is an answer, not a
// translation (K72); and no line may call anything safe.
export function translationProblem(source: string, translated: string): string | null {
  if (translated.trim() === "") return "empty";
  if (placeholders(source).join() !== placeholders(translated).join()) return "placeholders";
  if (digits(source).join() !== digits(translated).join()) return "numbers";
  if (translated.length > source.length * 2.5 + 40) return "tooLong";
  if (SAFE.test(translated)) return "safeWord";
  return null;
}
