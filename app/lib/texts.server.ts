import { copy } from "../../src/copy";
import { type LanguageId, TRANSLATIONS } from "../../src/copy/languages";
import type { Texts } from "../../src/copy/text";

// Every page needs the shell's words; each page adds the namespaces it draws from.
const SHELL = [
  "app.",
  "page.",
  "meta.",
  "notice.",
  "common.",
  "help.title",
  "nav.",
  "home.contact.organisation",
  "theme.",
];

export const PAGE_TEXTS = {
  home: [
    ...SHELL,
    "home.",
    "emergency.oneTap",
    "resume.",
    "hazard.",
    "stage.",
    "about.steps.title",
    ...[1, 2, 3, 4, 5, 6].map((n) => `about.step${n}.`),
    "about.emergency.",
  ],
  emergency: [
    ...SHELL,
    "emergency.",
    "limit.",
    "fieldError.emergency.",
    "error.",
    "hazard.",
    "card.emergency.victims.",
  ],
  start: [
    ...SHELL,
    "about.steps.title",
    ...[1, 2, 3, 4, 5, 6].map((n) => `about.step${n}.title`),
    "emergency.start",
    "emergency.startLead",
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
    "followUp.",
    "version.change",
    "chat.",
    "card.",
    "error.",
    "fieldError.",
    "limit.",
    "state.",
    "stage.",
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
  poster: [...SHELL, "poster."],
  info: [...SHELL, "info.", "emergency.call112", "emergency.call117", "emergency.callBpbd"],
  feed: [
    ...SHELL,
    "feed.",
    "hazard.",
    "hazardSubtype.",
    "desk.impact.",
    "desk.row.",
    "value.eventTime.",
    "limit.address.feed",
    "common.retryTime.",
  ],
  tracking: [
    ...SHELL,
    "tracking.",
    "stage.",
    "hazard.",
    "hazardSubtype.",
    "value.eventTime.",
    "card.sent.contact.",
    "error.network.lost",
  ],
  ownReport: [
    ...SHELL,
    "ownReport.",
    "followUp.",
    "news.",
    "common.retryTime.",
    "error.",
    "limit.",
    "version.",
    "tracking.",
    "stage.",
    "hazard.",
    "hazardSubtype.",
    "card.sent.contactPromise",
    "card.sent.contact.",
    "field.",
    "option.",
    "state.",
    "unit.",
    "value.",
    "card.placeSearch.rowVillage",
    "card.placeSearch.rowPlace",
    "card.placeConfirm.",
  ],
  about: [...SHELL, "about."],
  privacy: [...SHELL, "privacy."],
  notFound: [...SHELL, "notFound."],
  desk: [
    ...SHELL,
    "desk.",
    "version.",
    "stage.",
    "hazard.",
    "hazardSubtype.",
    "error.",
    "fieldError.",
    "limit.",
    "common.",
    "field.",
    "group.",
    "option.",
    "state.",
    "unit.",
    "value.",
    "card.summary.row",
    "card.placeSearch.rowVillage",
    "card.placeSearch.rowPlace",
    "card.placeConfirm.",
    "card.photos.badge.",
  ],
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

// The page's words, in the reporter's language where its file has them; Indonesian otherwise.
export function pickTexts(prefixes: readonly string[], body: unknown = null, language: LanguageId = "id"): Texts {
  const extra = keysIn(body, new Set());
  const words = TRANSLATIONS.get(language) ?? {};
  return Object.fromEntries(
    copy.keys
      .filter((key) => extra.has(key) || matches(key, prefixes))
      .map((key) => [key, words[key] ?? copy.text(key)]),
  );
}
