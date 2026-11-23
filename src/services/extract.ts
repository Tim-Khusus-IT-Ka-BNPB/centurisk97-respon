import type { DraftRecord } from "../adapters/d1/drafts";
import { claimModelCall } from "../adapters/d1/limits";
import type { Card } from "../contract/card";
import { copy } from "../copy";
import { type Extraction, validateExtraction } from "../domain/extraction";
import { chosenHazardType } from "../domain/fields/applicable";
import { LIMITS } from "../domain/limits";
import type { MaskedText } from "../domain/masking";
import { maskText, type Reporter } from "../domain/masking";
import { modelRequest } from "../domain/modelRequest";
import { templateParse } from "../domain/templateParse";
import { ticketDay } from "../domain/ticketNumber";
import type { DraftContent } from "../domain/turn/content";
import type { ServiceBindings } from "./bindings";

// The model is stopped before a turn's 6 seconds run out; its answer is never stored late.
const MODEL_DEADLINE_MS = 4500;

async function withinDeadline(work: Promise<unknown>, ms: number): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([work.catch(() => null), late]);
  } finally {
    clearTimeout(timer);
  }
}

// Values from the reporter's words: the model's answer when it may be asked and answers in time,
// else the template reading. Either way only what the masked message supports is kept.
export async function extractFrom(
  bindings: ServiceBindings,
  draft: DraftRecord,
  content: DraftContent,
  message: MaskedText,
  templatesOnly: boolean,
): Promise<Extraction> {
  const hazardType = chosenHazardType(content.states);
  let output: unknown = null;
  if (bindings.settings.model.mode !== "off" && !templatesOnly) {
    const caps = { draft: LIMITS["model.draft"].max, day: LIMITS["model.day"].max };
    const day = ticketDay(bindings.clock.now());
    if (await claimModelCall(bindings.db, draft.id, draft.numberKey, day, caps)) {
      const signal = AbortSignal.timeout(MODEL_DEADLINE_MS);
      output = await withinDeadline(
        bindings.model.extract(modelRequest(message, content.states), signal),
        MODEL_DEADLINE_MS,
      );
    }
  }
  return validateExtraction(output ?? templateParse(message), message, hazardType);
}

const textOf = (key: string) => (copy.has(key) ? copy.text(key) : null);

// The reporter's side of a card answer as one line of the conversation: the labels they picked
// and what they typed, masked.
export function answerLine(
  card: Card,
  optionIds: readonly string[],
  values: Readonly<Record<string, string>>,
  reporter: Reporter,
): string {
  const parts: string[] = [];
  const options = "options" in card ? card.options : [];
  for (const id of optionIds) {
    const label = textOf(options.find((option) => option.id === id)?.labelKey ?? `common.${id}`);
    if (label) parts.push(label);
  }
  const fields = "fields" in card ? card.fields : [];
  for (const [id, raw] of Object.entries(values)) {
    const typed = raw.trim();
    if (typed === "") continue;
    const label = textOf(fields.find((field) => field.id === id)?.labelKey ?? "");
    parts.push(label ? `${label}: ${typed}` : typed);
  }
  return maskText(parts.join(", "), reporter);
}
