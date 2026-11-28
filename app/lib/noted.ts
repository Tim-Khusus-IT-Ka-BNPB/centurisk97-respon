import type { Text } from "../../src/copy/text";
import { fieldById, isFieldId } from "../../src/domain/fields/catalogue";
import type { NotedFact } from "../../src/domain/turn/acknowledge";

// The values Sigap read from a message, as the line stores them; anything else is left out.
export function parseFacts(stored: unknown): readonly NotedFact[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(stored));
  } catch {
    return [];
  }
  return Array.isArray(parsed)
    ? parsed.filter((fact): fact is NotedFact => isFieldId((fact as { field?: unknown } | null)?.field))
    : [];
}

// One value as the reporter reads it back, in the page's language: "50 rumah terendam",
// "Tinggi air: Sepinggang", "Kebutuhan mendesak: Makanan siap saji, Air minum".
export function factText(t: Text, fact: NotedFact): string {
  const field = fieldById(fact.field);
  const none = t("reply.notedNone");
  if (field.kind === "count")
    return t(`reply.notedCount.${fact.field}`, {
      count: fact.value === null ? none : Number(fact.value).toLocaleString("id-ID"),
    });
  const label = t(`field.${fact.field}.label`);
  const option = (id: string) => t(`option.${fact.field}.${id}.label`);
  let value: string;
  if (fact.value === null) value = none;
  else if (Array.isArray(fact.value)) value = fact.value.map(option).join(", ");
  else value = field.kind === "choice" ? option(String(fact.value)) : String(fact.value);
  return t("reply.notedChoice", { label, value });
}
