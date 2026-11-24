import { copy } from "../../src/copy";
import type { Texts } from "./text";

// Every page needs the shell's words; each page adds the namespaces it draws from.
const SHELL = ["app.", "page.", "meta.", "notice.", "common.", "help.title", "nav.", "home.contact.organisation"];

export const PAGE_TEXTS = {
  home: [
    ...SHELL,
    "home.",
    "resume.",
    "hazard.",
    "about.steps.title",
    ...[1, 2, 3, 4, 5, 6].map((n) => `about.step${n}.`),
    "about.emergency.",
  ],
  start: [
    ...SHELL,
    "home.report",
    "identity.",
    "consent.",
    "known.",
    "resume.",
    "start.",
    "card.confirm.",
    "fieldError.",
    "error.",
    "limit.",
    "hazard.",
    "privacy.",
  ],
  draft: [
    ...SHELL,
    "home.report",
    "chat.",
    "card.",
    "error.",
    "fieldError.",
    "limit.",
    "state.",
    "unit.",
    "value.",
    "refusal.",
    "reply.",
    "resume.",
    "identity.role.",
    "field.",
    "group.",
    "option.",
    "hazard.",
    "hazardSubtype.",
    "chronology.otherHint",
    "about.words.",
  ],
  // A draft that cannot be opened needs only its card's words.
  refused: [...SHELL, "card.expired.new", "common.retryTime."],
  help: [...SHELL, "help."],
  about: [...SHELL, "about."],
  privacy: [...SHELL, "privacy."],
  notFound: [...SHELL, "notFound."],
} as const;

const matches = (key: string, prefixes: readonly string[]) =>
  prefixes.some((prefix) => (prefix.endsWith(".") ? key.startsWith(prefix) : key === prefix));

// Every string in a body that is a catalogue key: the card's labels and the transcript's lines.
function keysIn(value: unknown, found: Set<string>): Set<string> {
  if (typeof value === "string") {
    if (copy.has(value)) found.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) keysIn(item, found);
  } else if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) keysIn(item, found);
  }
  return found;
}

export function pickTexts(prefixes: readonly string[], body: unknown = null): Texts {
  const extra = keysIn(body, new Set());
  return Object.fromEntries(
    copy.keys.filter((key) => extra.has(key) || matches(key, prefixes)).map((key) => [key, copy.text(key)]),
  );
}
