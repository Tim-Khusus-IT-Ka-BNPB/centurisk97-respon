import { parseEventTimeText } from "../eventTime";
import type { Extraction, QuotedValue } from "../extraction";
import { countState, type FieldState, isSettled, quoted } from "../fieldState";
import { keepableFields } from "../fields/applicable";
import { type FieldId, fieldById } from "../fields/catalogue";
import type { FieldError } from "../identityForm";
import { LENGTHS } from "../limits";
import type { MaskedText } from "../masking";
import { tidy } from "../text";
import { type TopicVerdict, topicGate } from "../topicGate";
import { type AskedCounts, type DraftContent, type Question, questionFields } from "./content";
import type { AnswerContext } from "./forms";

export type FreeTextKind =
  | { readonly kind: "back" }
  | { readonly kind: "cancel" }
  | { readonly kind: "tooLong"; readonly length: number }
  | { readonly kind: "refused"; readonly topic: TopicVerdict }
  // "cek status": the reporter's sent reports are listed, nothing in the draft changes.
  | { readonly kind: "status" }
  | { readonly kind: "story" };

const BACK_WORDS = /^(?:kembali|balik|salah pilih|undo)$/i;
const CANCEL_WORDS = /^(?:batal|batalkan|batalkan laporan)$/i;
// Matched after tidy(), which leaves one space between words.
const STATUS_WORDS = /^(?:cek )?status(?: laporan(?: saya)?)?$/i;

// What a typed message is, before anything reaches the model: a command, too long, off topic, or a story.
export function classifyFreeText(text: string): FreeTextKind {
  const words = tidy(text).replace(/[.!]+$/, "");
  if (BACK_WORDS.test(words)) return { kind: "back" };
  if (CANCEL_WORDS.test(words)) return { kind: "cancel" };
  if (STATUS_WORDS.test(words)) return { kind: "status" };
  if (text.length > LENGTHS.message.max) return { kind: "tooLong", length: text.length };
  const topic = topicGate(text);
  return topic ? { kind: "refused", topic } : { kind: "story" };
}

export type StoryResult =
  | {
      readonly kind: "applied";
      readonly content: DraftContent;
      readonly asked: AskedCounts;
      readonly changed: readonly FieldId[];
    }
  | { readonly kind: "invalid"; readonly errors: readonly FieldError[] };

const UNKNOWN_WORDS = /^(?:belum tahu|tidak tahu|belum diketahui)$/i;
const NONE_WORDS = /^(?:tidak ada|nihil)$/i;

// The current card answered in words: a time, a text answer, or "belum tahu" and "tidak ada" for a form.
function directAnswer(
  question: Question,
  message: MaskedText,
  context: AnswerContext,
): Partial<Record<FieldId, FieldState>> | FieldError {
  const text = tidy(message).replace(/[.!]+$/, "");
  const fields = questionFields(question);
  if (question.kind === "eventTime") {
    const parsed = parseEventTimeText(message, context.nowMs, context.zone);
    if ("error" in parsed)
      return {
        fieldId: "date",
        rule: `time.${parsed.error === "dateFormat" ? "dateRequired" : parsed.error}`,
        params: { label: "card.timeCard.date" },
      };
    return { eventTime: { state: "value", value: parsed.value, origin: "quote", quote: message } };
  }
  if (question.kind !== "numberForm" && question.kind !== "textQuestion") return {};
  const quote = { origin: "quote", quote: message } as const;
  let state: FieldState | null = null;
  if (UNKNOWN_WORDS.test(text)) state = { state: "confirmedUnknown", ...quote };
  else if (NONE_WORDS.test(text)) state = { state: "none", ...quote };
  else if (question.kind === "textQuestion") state = { state: "value", value: message, ...quote };
  if (state === null) return {};
  return Object.fromEntries(fields.map((fieldId) => [fieldId, state]));
}

// A value read from the reporter's words, stored as a tapped answer would be: one option, several,
// or a none, with the words it came from.
function storyState(fieldId: FieldId, value: QuotedValue): FieldState {
  if (value.kind === "count") return countState(value.count, "quote", value.quote, value.translation);
  const source = quoted(value.quote, value.translation);
  if (value.kind === "text") return { state: "value", value: value.text, ...source };
  const field = fieldById(fieldId) as {
    readonly kind: string;
    readonly options: readonly { id: string; meaning?: string }[];
  };
  const [first] = value.optionIds;
  if (field.options.some((option) => option.id === first && option.meaning === "none"))
    return { state: "none", ...source };
  if (field.kind === "choice") return { state: "value", value: first as string, ...source };
  return { state: "value", value: { optionIds: value.optionIds, otherText: null }, ...source };
}

// Applies a story: the card's own answer, then each value the extraction kept. A value never
// replaces a settled answer, except on the summary or in a reopened group, where words correct it.
export function applyStory(
  question: Question,
  content: DraftContent,
  asked: AskedCounts,
  message: MaskedText,
  extraction: Extraction,
  context: AnswerContext,
): StoryResult {
  const direct = directAnswer(question, message, context);
  if ("rule" in direct) return { kind: "invalid", errors: [direct as FieldError] };
  const correcting = question.kind === "summary" || content.overlay?.kind === "edit";
  const offered: Partial<Record<FieldId, FieldState>> = {};
  for (const [id, value] of Object.entries(extraction.fields)) {
    const fieldId = id as FieldId;
    if (!correcting && isSettled(content.states[fieldId])) continue;
    offered[fieldId] = storyState(fieldId, value);
  }
  Object.assign(offered, direct);
  const applicable = new Set(keepableFields({ ...content.states, ...offered }).map((field) => field.id));
  const states = Object.fromEntries(Object.entries(offered).filter(([fieldId]) => applicable.has(fieldId))) as Partial<
    Record<FieldId, FieldState>
  >;
  const guesses = [...new Set([...extraction.hazardGuesses.map((guess) => guess.hazardType), ...content.guesses])];
  const changed = Object.keys(states) as FieldId[];
  let overlay = content.overlay;
  const own = questionFields(question);
  if (overlay?.kind === "edit" && changed.some((fieldId) => own.includes(fieldId)))
    overlay = { ...overlay, done: [...overlay.done, ...own] };
  return {
    kind: "applied",
    content: { ...content, states: { ...content.states, ...states }, guesses, overlay, danger: null },
    asked,
    changed,
  };
}
