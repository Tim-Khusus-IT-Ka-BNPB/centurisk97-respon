import { readClock } from "../eventTime";
import { folded, tidy } from "../text";

// What a reporter's reply in a chat means, read from what they were asked. A reply no reading fits
// is words: the conversation reads those as it reads any sentence. Nothing is guessed.

export type Choice = {
  readonly id: string;
  readonly label: string;
  // The choice goes with words of the reporter's own ("Lainnya").
  readonly freeText?: boolean;
  // The choice a plain "ya" or "tidak" stands for.
  readonly means?: "yes" | "no";
};

export type ChoiceRead =
  | { readonly kind: "picked"; readonly ids: readonly string[]; readonly words: string }
  | { readonly kind: "outOfRange"; readonly max: number }
  | { readonly kind: "onlyOne" }
  | { readonly kind: "words" };

const NUMBERS_FIRST = /^((?:\d{1,2}(?=\D|$)[ ,;&+/.)]*(?:dan )?)+)(.*)/i;
const BETWEEN_LABELS = / ?(?:[,;&+/]|\bdan\b) ?/;

// A reply as its words: no marks, no case, no full stop.
export const said = (text: string): string => folded(text).replace(/[.!]+$/, "");

const MEANING = [
  ["yes", /^(?:(?:ya|iya|y|ok|oke)(?:,? (?:mau|boleh|betul|benar))?|mau|boleh|betul|benar)$/],
  ["no", /^(?:(?:tidak|tdk|nggak|enggak|ga|gak)(?: (?:usah|perlu|mau))?|bukan|jangan)$/],
] as const;

// Words a person says beside an answer: "saya warga", "warga aja".
const FILLER = /\b(?:saya|aja|saja|sih|dong|deh|kak|pak|bu)\b/g;

// Numbers, the words of an answer, or the start of one answer alone.
export function readChoice(text: string, choices: readonly Choice[], multiple = false): ChoiceRead {
  const words = said(text);
  const labels = choices.map((choice) => said(choice.label));
  const picked = (ids: readonly string[], rest = ""): ChoiceRead => ({
    kind: "picked",
    ids: [...new Set(ids)],
    words: rest,
  });
  const idAt = (index: number) => (choices[index] as Choice).id;
  const bare = tidy(words.replace(FILLER, ""));
  const named = labels.findIndex((label) => label === words || label === bare);
  if (named >= 0) return picked([idAt(named)]);
  const meaning = MEANING.find(([, pattern]) => pattern.test(bare))?.[0];
  const meant = meaning && choices.find((choice) => choice.means === meaning);
  if (meant) return picked([meant.id]);
  const numbered = NUMBERS_FIRST.exec(tidy(text));
  if (numbered) {
    const places = ((numbered[1] as string).match(/\d+/g) as string[]).map(Number);
    const rest = numbered[2] as string;
    const inRange = places.every((place) => place >= 1 && place <= choices.length);
    if (rest !== "") {
      const last = choices[(places.at(-1) as number) - 1] as Choice;
      return inRange && last.freeText && (multiple || places.length === 1)
        ? picked(
            places.map((place) => idAt(place - 1)),
            rest,
          )
        : { kind: "words" };
    }
    if (!inRange) return { kind: "outOfRange", max: choices.length };
    if (!multiple && new Set(places).size > 1) return { kind: "onlyOne" };
    return picked(places.map((place) => idAt(place - 1)));
  }
  const listed = multiple ? words.split(BETWEEN_LABELS).map((part) => labels.indexOf(part)) : [-1];
  if (!listed.includes(-1)) return picked(listed.map(idAt));
  const begun = labels.flatMap((label, index) =>
    words !== "" && label.startsWith(words) && /^\P{L}/u.test(label.slice(words.length)) ? [index] : [],
  );
  return begun.length === 1 ? picked([idAt(begun[0] as number)]) : { kind: "words" };
}

const NONE = /^(?:tidak ada(?: semua)?|nihil)$/;
const UNKNOWN = /^(?:(?:belum|tidak) (?:tahu|diketahui)|ga(?:k)? tahu)$/;
const SKIP = /^(?:lewati|lewat|kosong)$/;

export const saysUnknown = (text: string): boolean => UNKNOWN.test(said(text));
export const saysSkip = (text: string): boolean => SKIP.test(said(text));

export type NumbersRead =
  // One value per count asked, in order; empty where it is not known.
  | { readonly kind: "values"; readonly values: readonly string[] }
  | { readonly kind: "all"; readonly action: "allNone" | "allUnknown" }
  | { readonly kind: "wrongCount"; readonly given: number }
  | { readonly kind: "words" };

const NUMBER_OR_NOT = /^(?:\d[\d.]*|-|\?)$/;

// "2 0 -" for three counts. Fewer or more numbers than counts do not say which they are for.
export function readNumbers(text: string, asked: number): NumbersRead {
  const words = said(text);
  if (NONE.test(words)) return { kind: "all", action: "allNone" };
  if (UNKNOWN.test(words)) return { kind: "all", action: "allUnknown" };
  if (SKIP.test(words)) return { kind: "values", values: Array<string>(asked).fill("") };
  const parts = tidy(text).split(/[\s,;/]+/);
  if (!parts.every((part) => NUMBER_OR_NOT.test(part))) return { kind: "words" };
  return parts.length === asked
    ? { kind: "values", values: parts.map((part) => (/\d/.test(part) ? part : "")) }
    : { kind: "wrongCount", given: parts.length };
}

const BARE_HOUR = /^\d{1,2}$/;

// The hour of a day already told: "14.30", "jam 2 siang", "14", or not known. Null when it is neither.
export function readHour(text: string): { readonly hour: string | null } | null {
  const words = said(text);
  if (UNKNOWN.test(words) || words === "-") return { hour: null };
  if (BARE_HOUR.test(words)) return { hour: `${words}.00` };
  const clock = readClock(words);
  return clock === null ? null : { hour: clock };
}

export type Neighbourhood = { readonly rt: string; readonly rw: string };

const RT = /\brt\W*(\d+)/;
const RW = /\brw\W*(\d+)/;
const PAIR = /^(\d+)(?: ?\/ ?| )(\d+)$/;

// "RT 4 RW 2", "4/2", one of the two, or not known. Null when it is none of these.
export function readNeighbourhood(text: string): Neighbourhood | "unknown" | null {
  const words = said(text);
  if (UNKNOWN.test(words) || words === "-") return "unknown";
  const pair = PAIR.exec(words);
  if (pair) return { rt: pair[1] as string, rw: pair[2] as string };
  const rt = RT.exec(words)?.[1] ?? "";
  const rw = RW.exec(words)?.[1] ?? "";
  return rt === "" && rw === "" ? null : { rt, rw };
}

const DAYS = ["today", "yesterday", "olderThan30Days"] as const;
export type Day = (typeof DAYS)[number];

const DAY_FIRST = /^([1-3])[.)]?(?: (.+))?$/;

// The day picked by its number, with the hour when it was told with it. Any other words are read as
// a date by the conversation.
export function readDay(text: string): { readonly day: Day; readonly hour: string | null | undefined } | null {
  const match = DAY_FIRST.exec(tidy(text));
  if (!match) return null;
  const day = DAYS[Number(match[1]) - 1] as Day;
  if (match[2] === undefined) return { day, hour: undefined };
  const told = day === "olderThan30Days" ? null : readHour(match[2]);
  return told === null ? null : { day, hour: told.hour };
}
