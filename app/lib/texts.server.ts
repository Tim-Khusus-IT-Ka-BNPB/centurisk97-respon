import { copy } from "../../src/copy";
import { type LanguageId, languageFrom } from "../../src/copy/languages";
import type { Texts } from "../../src/copy/text";
import { TRANSLATIONS } from "../../src/copy/translations";

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
  "sigap.",
];

export const PAGE_TEXTS = {
  home: [
    ...SHELL,
    "home.",
    "missing.mine.item",
    "missing.anonymous",
    "missing.status.",
    "resume.",
    "hazard.",
    "stage.",
    "about.emergency.",
    // The example conversation's lines, as the report's own words.
    "reply.noted",
    "reply.notedChoice",
    "reply.notedCount.housesFlooded",
    "field.waterDepth.label",
    "option.waterDepth.knee.label",
    "field.trapped.label",
    "option.trapped.",
    "card.sent.number",
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
    "safety.",
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
  info: [
    ...SHELL,
    "info.",
    "emergency.call112",
    "emergency.call117",
    "emergency.callBpbd",
    // Reading the phone's place, worded as on the report's place card.
    "card.placeSearch.locate",
    "card.placeSearch.locateHint",
    "card.placeSearch.locating",
    "card.placeSearch.retry",
    "card.placeSearch.denied",
    "card.placeSearch.unavailable",
    "card.placeSearch.timeout",
    "card.placeSearch.unsupported",
  ],
  language: [...SHELL],
  numbers: [...SHELL, "numbers.", "card.sent.numbers.", "home.contact."],
  missing: [...SHELL, "missing.", "fieldError.missing.", "error.", "limit.", "card.sent.numbers."],
  feed: [
    ...SHELL,
    "feed.",
    "watch.",
    "info.level.",
    "hazard.",
    "hazardSubtype.",
    "desk.impact.",
    "desk.row.",
    "value.eventTime.",
    "limit.address.feed",
    "common.retryTime.",
  ],
  feedCard: [
    ...SHELL,
    "feed.",
    "hazard.",
    "hazardSubtype.",
    "desk.impact.",
    "desk.row.",
    "value.eventTime.",
    "error.comments.",
    "error.request.",
    "fieldError.comment.",
    "limit.",
    "common.retryTime.",
  ],
  today: [
    ...SHELL,
    "today.",
    "feed.place",
    "feed.event",
    "feed.count",
    "feed.map.failed",
    "hazard.",
    "hazardSubtype.",
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
    "card.sent.link.",
    "card.sent.qr",
    "card.sent.qrHint",
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
    // The follow-up file's videos are sent with the report's own uploader.
    "card.video.",
    "missing.",
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

// The language a public page is drawn in: the visitor's pick, kept in a cookie for the whole site.
export const languageOf = (request: Request): LanguageId => languageFrom(request.headers.get("cookie"));
