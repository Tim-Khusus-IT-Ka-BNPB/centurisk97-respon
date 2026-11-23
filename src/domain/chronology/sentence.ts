import type { HazardTypeId } from "../hazards";
import { chronologySteps } from "./index";

// Text of a copy key; the domain gets it from the caller so it stays free of the catalogue.
export type PhraseOf = (key: string) => string;

const STARTS_LOWER = /^\p{Ll}/u;
const ENDS_SENTENCE = /[.!?]$/;

// Joins step sentences into one chronology. A sentence that starts in lower case continues the
// one before it ("dan menghanguskan rumah."); any other starts a new sentence. It ends with a full stop.
export function joinChronology(sentences: readonly string[]): string {
  let text = "";
  for (const sentence of sentences) {
    if (text === "") text = sentence;
    else if (STARTS_LOWER.test(sentence)) text = `${text.replace(/\.$/, "")} ${sentence}`;
    else text = `${ENDS_SENTENCE.test(text) ? text : `${text}.`} ${sentence}`;
  }
  return text === "" || ENDS_SENTENCE.test(text) ? text : `${text}.`;
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

export type ChronologyAnswers = {
  readonly steps: readonly (readonly string[])[];
  readonly otherText: Readonly<Record<number, string>>;
};

// The sentence of one answered step, or null when its answer adds nothing ("Tidak tahu").
// A multiple choice step is its prefix and the chosen phrases; a typed "Lainnya" joins them.
export function stepSentence(
  hazardType: HazardTypeId,
  index: number,
  answers: ChronologyAnswers,
  phraseOf: PhraseOf,
): string | null {
  const step = chronologySteps(hazardType)[index];
  if (!step) return null;
  const picked = answers.steps[index] as readonly string[];
  const base = `chronology.${hazardType}.step${index + 1}`;
  const parts: string[] = [];
  for (const id of picked) {
    const option = step.options.find((candidate) => candidate.id === id);
    if (option?.freeText) {
      const typed = answers.otherText[index];
      if (typed) parts.push(lowerFirst(typed));
    } else if (option?.phrase) parts.push(phraseOf(`${base}.option.${id}.phrase`));
  }
  if (parts.length === 0) return null;
  return step.prefix ? `${phraseOf(`${base}.prefix`)} ${parts.join(", ")}.` : (parts[0] as string);
}

// The whole guided chronology, with the reporter's own note last.
export function chronologyText(
  hazardType: HazardTypeId,
  answers: ChronologyAnswers,
  note: string | null,
  phraseOf: PhraseOf,
): string {
  const sentences = answers.steps
    .map((_picked, index) => stepSentence(hazardType, index, answers, phraseOf))
    .filter((sentence): sentence is string => sentence !== null);
  if (note) sentences.push(note);
  return joinChronology(sentences);
}
