// What a language file may change: every word a member of the public reads on the site, and nothing
// only staff read. No imports, so the translation tool shares these rules.

// Staff's own words stay Indonesian: the desk, its documents and counts, the village posters it
// prints, and the warnings the cron sends, which go out before anyone's language is known.
export const STAFF_ONLY = ["desk.", "aggregate.", "document.", "missing.desk.", "poster.", "warn.push."] as const;

// app.lang names the file's language and is never translated.
export const isTranslated = (key: string) => key !== "app.lang" && !STAFF_ONLY.some((prefix) => key.startsWith(prefix));

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
