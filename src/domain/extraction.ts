import { fieldsForHazard } from "./fields/applicable";
import { FIELDS, type FieldDefinition, type FieldId } from "./fields/catalogue";
import { applicableOptions } from "./fields/options";
import { type HazardTypeId, isSelectableHazardType, isSubtypeOf } from "./hazards";
import type { MaskedText } from "./masking";
import { MESSAGE_LANGUAGES, type MessageLanguage } from "./modelRequest";
import { findNumbers } from "./numbers";
import { folded, wordsOf } from "./text";

// Reply ids the model may pick; the sentence for each lives in the copy catalogue under reply.<id>.
const REPLY_IDS = ["sympathy", "thanks", "calm", "none"] as const;
type ReplyId = (typeof REPLY_IDS)[number];

const TOPIC_IDS = ["disaster", "offTopic", "dataRequest"] as const;
type TopicId = (typeof TOPIC_IDS)[number];

// A value the reporter's words state, with those words and, for words not in Indonesian, how they
// read in Indonesian for the desk.
export type QuotedValue =
  | { readonly kind: "count"; readonly count: number; readonly quote: string; readonly translation: string | null }
  | { readonly kind: "text"; readonly text: string; readonly quote: string; readonly translation: string | null }
  | {
      readonly kind: "options";
      readonly optionIds: readonly string[];
      readonly quote: string;
      readonly translation: string | null;
    };

export type Extraction = {
  readonly fields: Partial<Record<FieldId, QuotedValue>>;
  readonly hazardGuesses: readonly { readonly hazardType: HazardTypeId; readonly subtype: string | null }[];
  readonly lifeAtRisk: boolean;
  readonly reply: ReplyId | null;
  readonly topic: TopicId;
  // The message's language, "other" for one the page does not offer, null when not given.
  readonly language: MessageLanguage | "other" | null;
  // The message in Indonesian, for a message in another language; null otherwise.
  readonly indonesian: string | null;
};

const NEGATION = /(?<![\p{L}\p{N}])(?:tidak ada|tidak|nihil|tanpa|nol|belum ada)(?![\p{L}\p{N}])/u;
const MAX_GUESSES = 4;
// Short connecting words of a text value need not appear in the message.
const MIN_CHECKED_WORD = 3;
// A translation runs longer than its message, but never this long.
const MAX_TRANSLATION = 4000;

type Fillable = Extract<FieldDefinition, { kind: "count" | "text" | "choice" | "multiChoice" }>;
type Item = {
  readonly field?: unknown;
  readonly value?: unknown;
  readonly quote?: unknown;
  readonly quoteIndonesian?: unknown;
} | null;
type Guess = { readonly hazardType?: unknown; readonly subtype?: unknown; readonly confidence?: unknown } | null;

const states = (text: string, count: number) => findNumbers(text).has(count) || (count === 0 && NEGATION.test(text));

// A count is kept only when its words state it: the number, or a none said with a negation. Words
// in another language are read through their Indonesian rendering, unless they hold a number of
// their own, which must then be this one.
function quotedCount(value: string, quote: string, translation: string | null, max: number): number | null {
  if (!/^\d+$/.test(value)) return null;
  const count = Number(value);
  if (count > max) return null;
  if (states(quote, count)) return count;
  if (/\d/.test(quote) || findNumbers(quote).size > 0 || translation === null) return null;
  return states(folded(translation), count) ? count : null;
}

// A text value is kept only when every word it holds is the reporter's own.
function ownWords(value: string, message: string): boolean {
  const said = new Set(wordsOf(message));
  return wordsOf(value).every((word) => word.length < MIN_CHECKED_WORD || said.has(word));
}

// The options a value names: the field's own, offered for the hazard, never "not known" or one that
// needs words of its own. A none stands alone, and a single choice holds one.
function quotedOptions(
  field: Extract<Fillable, { kind: "choice" | "multiChoice" }>,
  value: string,
  hazardType: HazardTypeId | null,
): readonly string[] | null {
  const named = new Set(value.split(",").map((id) => id.trim()));
  const picked = applicableOptions(field.options, hazardType).filter(
    (option) => named.has(option.id) && option.meaning !== "unknown" && option.freeTextMaxLength === undefined,
  );
  if (picked.length === 0) return null;
  if (picked.length > 1 && (field.kind === "choice" || picked.some((option) => option.meaning === "none"))) return null;
  return picked.map((option) => option.id);
}

function extractedField(
  item: Item,
  message: string,
  allowed: ReadonlyMap<string, Fillable>,
  hazardType: HazardTypeId | null,
): QuotedValue | null {
  const field = allowed.get(item?.field as string);
  if (!field) return null;
  const { quote: rawQuote, value: rawValue, quoteIndonesian } = item as NonNullable<Item>;
  if (typeof rawQuote !== "string" || typeof rawValue !== "string") return null;
  const quote = folded(rawQuote);
  if (quote === "" || !message.includes(quote)) return null;
  const rendered = typeof quoteIndonesian === "string" ? quoteIndonesian.trim() : "";
  const translation = rendered === "" || folded(rendered) === quote ? null : rendered;
  if (field.kind === "count") {
    const count = quotedCount(folded(rawValue), quote, translation, field.max);
    return count === null ? null : { kind: "count", count, quote, translation };
  }
  if (field.kind === "text") {
    const text = folded(rawValue);
    if (text === "" || text.length > field.maxLength || !ownWords(text, message)) return null;
    return { kind: "text", text, quote, translation };
  }
  const optionIds = quotedOptions(field, rawValue, hazardType);
  return optionIds === null ? null : { kind: "options", optionIds, quote, translation };
}

function guesses(value: unknown): Extraction["hazardGuesses"] {
  if (!Array.isArray(value)) return [];
  return (value as Guess[])
    .filter((guess): guess is NonNullable<Guess> => isSelectableHazardType(guess?.hazardType))
    .sort((a, b) => Number(b.confidence ?? 0) - Number(a.confidence ?? 0))
    .slice(0, MAX_GUESSES)
    .map((guess) => {
      const hazardType = guess.hazardType as HazardTypeId;
      return { hazardType, subtype: isSubtypeOf(hazardType, guess.subtype) ? (guess.subtype as string) : null };
    });
}

function languageOf(value: unknown): Extraction["language"] {
  if (value === "other") return "other";
  return MESSAGE_LANGUAGES.find((id) => id === value) ?? null;
}

// Keeps from a model's answer only what the reporter's masked message supports. Everything
// else, including any sentence the model wrote for the reporter, is dropped; the translation is kept
// for the desk only.
export function validateExtraction(output: unknown, message: MaskedText, hazardType: HazardTypeId | null): Extraction {
  const answer = Object(output) as Readonly<Record<string, unknown>>;
  const said = folded(message);
  const hazardGuesses = guesses(answer.hazardGuesses);
  const allowed = new Map<string, Fillable>();
  // Before the hazard type is chosen a value of any type is kept; choosing the type drops what it rules out.
  for (const field of hazardType === null ? FIELDS : fieldsForHazard(hazardType)) {
    if (field.kind === "count" || field.kind === "text" || field.kind === "choice" || field.kind === "multiChoice")
      allowed.set(field.id, field);
  }
  // Options offered for one hazard only are read against the type chosen, or the likeliest one.
  const optionsHazard = hazardType ?? hazardGuesses[0]?.hazardType ?? null;
  const fields: Partial<Record<FieldId, QuotedValue>> = {};
  if (Array.isArray(answer.fields)) {
    for (const item of answer.fields as Item[]) {
      const kept = extractedField(item, said, allowed, optionsHazard);
      if (kept) fields[item?.field as FieldId] = kept;
    }
  }
  const reply = REPLY_IDS.find((id) => id === answer.reply) ?? null;
  const topic = TOPIC_IDS.find((id) => id === answer.topic) ?? "disaster";
  const language = languageOf(answer.language);
  const rendered = typeof answer.indonesian === "string" ? answer.indonesian.trim().slice(0, MAX_TRANSLATION) : "";
  const indonesian = language === null || language === "id" || rendered === "" ? null : rendered;
  return { fields, hazardGuesses, lifeAtRisk: answer.lifeAtRisk === true, reply, topic, language, indonesian };
}
