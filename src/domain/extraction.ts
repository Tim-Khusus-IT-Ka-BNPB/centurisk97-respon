import { fieldsForHazard } from "./fields/applicable";
import { FIELDS, type FieldDefinition, type FieldId } from "./fields/catalogue";
import { type HazardTypeId, isSelectableHazardType, isSubtypeOf } from "./hazards";
import type { MaskedText } from "./masking";
import { findNumbers } from "./numbers";
import { folded, wordsOf } from "./text";

// Reply ids the model may pick; the sentence for each lives in the copy catalogue under reply.<id>.
const REPLY_IDS = ["sympathy", "thanks", "calm", "none"] as const;
type ReplyId = (typeof REPLY_IDS)[number];

const TOPIC_IDS = ["disaster", "offTopic", "dataRequest"] as const;
type TopicId = (typeof TOPIC_IDS)[number];

type QuotedValue =
  | { readonly kind: "count"; readonly count: number; readonly quote: string }
  | { readonly kind: "text"; readonly text: string; readonly quote: string };

export type Extraction = {
  readonly fields: Partial<Record<FieldId, QuotedValue>>;
  readonly hazardGuesses: readonly { readonly hazardType: HazardTypeId; readonly subtype: string | null }[];
  readonly lifeAtRisk: boolean;
  readonly reply: ReplyId | null;
  readonly topic: TopicId;
};

const NEGATION = /(?<![\p{L}\p{N}])(?:tidak ada|tidak|nihil|tanpa|nol|belum ada)(?![\p{L}\p{N}])/u;
const MAX_GUESSES = 4;
// Short connecting words of a text value need not appear in the message.
const MIN_CHECKED_WORD = 3;

type CountOrText = Extract<FieldDefinition, { kind: "count" | "text" }>;
type Item = { readonly field?: unknown; readonly value?: unknown; readonly quote?: unknown } | null | undefined;
type Guess = { readonly hazardType?: unknown; readonly subtype?: unknown; readonly confidence?: unknown } | null;

// A count is kept only when its quote states that number, or a zero is said with a negation.
function quotedCount(value: string, quote: string, max: number): number | null {
  if (!/^\d+$/.test(value)) return null;
  const count = Number(value);
  if (count > max) return null;
  if (findNumbers(quote).has(count) || (count === 0 && NEGATION.test(quote))) return count;
  return null;
}

// A text value is kept only when every word it holds is the reporter's own.
function ownWords(value: string, message: string): boolean {
  const said = new Set(wordsOf(message));
  return wordsOf(value).every((word) => word.length < MIN_CHECKED_WORD || said.has(word));
}

function extractedField(item: Item, message: string, allowed: ReadonlyMap<string, CountOrText>): QuotedValue | null {
  const field = allowed.get(item?.field as string);
  if (!field) return null;
  const { quote: rawQuote, value: rawValue } = item as NonNullable<Item>;
  if (typeof rawQuote !== "string" || typeof rawValue !== "string") return null;
  const quote = folded(rawQuote);
  if (quote === "" || !message.includes(quote)) return null;
  const value = folded(rawValue);
  if (field.kind === "count") {
    const count = quotedCount(value, quote, field.max);
    return count === null ? null : { kind: "count", count, quote };
  }
  if (value === "" || value.length > field.maxLength || !ownWords(value, message)) return null;
  return { kind: "text", text: value, quote };
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

// Keeps from a model's answer only what the reporter's masked message supports. Everything
// else, including any sentence the model wrote, is dropped.
export function validateExtraction(output: unknown, message: MaskedText, hazardType: HazardTypeId | null): Extraction {
  const answer = Object(output) as Readonly<Record<string, unknown>>;
  const said = folded(message);
  const allowed = new Map<string, CountOrText>();
  // Before the hazard type is chosen a value of any type is kept; choosing the type drops what it rules out.
  for (const field of hazardType === null ? FIELDS : fieldsForHazard(hazardType)) {
    if (field.kind === "count" || field.kind === "text") allowed.set(field.id, field);
  }
  const fields: Partial<Record<FieldId, QuotedValue>> = {};
  if (Array.isArray(answer.fields)) {
    for (const item of answer.fields as Item[]) {
      const kept = extractedField(item, said, allowed);
      if (kept) fields[item?.field as FieldId] = kept;
    }
  }
  const reply = REPLY_IDS.find((id) => id === answer.reply) ?? null;
  const topic = TOPIC_IDS.find((id) => id === answer.topic) ?? "disaster";
  return { fields, hazardGuesses: guesses(answer.hazardGuesses), lifeAtRisk: answer.lifeAtRisk === true, reply, topic };
}
