// Inputs are named by their field id. The draft page action reads a box as "value.<fieldId>",
// so every name that is not a turn control is moved under that prefix. "intent" only tells the
// page which button is busy and never leaves it.
const CONTROLS = new Set([
  "action",
  "kind",
  "cardId",
  "revision",
  "turnKey",
  "optionIds",
  "text",
  "groupId",
  "villageCode",
  // The photo form's file goes to the photo route as it is.
  "photo",
]);
export const INTENT = "intent";

export function toTurnForm(form: FormData): FormData {
  const turn = new FormData();
  for (const [name, value] of form) {
    if (name !== INTENT) turn.append(CONTROLS.has(name) ? name : `value.${name}`, value);
  }
  return turn;
}

// What was sent, by name, so a form redrawn after a refusal keeps every value, radio and checkbox.
export type Posted = Readonly<Record<string, readonly string[]>>;

export function postedOf(form: FormData): Posted {
  const posted: Record<string, string[]> = {};
  for (const [name, value] of form) {
    if (typeof value !== "string") continue;
    posted[name] = [...(posted[name] ?? []), value];
  }
  return posted;
}

const firstOf = (posted: Posted | null, name: string): string | null => posted?.[name]?.[0] ?? null;

// A refused value comes back as sent; otherwise the card's own value.
export const postedValue = (posted: Posted | null, name: string, fallback: string | number | null): string =>
  firstOf(posted, name) ?? (fallback === null ? "" : String(fallback));
