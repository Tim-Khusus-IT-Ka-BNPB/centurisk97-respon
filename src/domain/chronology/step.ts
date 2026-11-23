// One step of the guided chronology: one question with its answers. Question, warning, prefix,
// labels and phrases live in the copy catalogue under chronology.<hazardTypeId>.step<N>.
export type ChronologyOption = {
  readonly id: string;
  // False when the answer adds nothing to the built sentence, such as "Tidak tahu".
  readonly phrase: boolean;
  // Marks an answer after which the step's warning shows once.
  readonly danger?: true;
  // The typed answer "Lainnya" on a multiple choice step.
  readonly freeText?: true;
};

export type ChronologyStep = {
  readonly multiple: boolean;
  readonly warning: boolean;
  readonly prefix: boolean;
  readonly options: readonly ChronologyOption[];
};

export const said = (id: string): ChronologyOption => ({ id, phrase: true });
export const danger = (id: string): ChronologyOption => ({ id, phrase: true, danger: true });
export const silent = (id: string): ChronologyOption => ({ id, phrase: false });
export const typed: ChronologyOption = { id: "other", phrase: false, freeText: true };

export function single(warning: boolean, ...options: ChronologyOption[]): ChronologyStep {
  return { multiple: false, warning, prefix: false, options };
}

// A multiple choice step always starts its sentence with a prefix.
export function several(warning: boolean, ...options: ChronologyOption[]): ChronologyStep {
  return { multiple: true, warning, prefix: true, options };
}

// On a multiple choice step a silent answer (none, not known) cannot be picked with others.
export function isExclusive(step: ChronologyStep, option: ChronologyOption): boolean {
  return step.multiple && !option.phrase && !option.freeText;
}
