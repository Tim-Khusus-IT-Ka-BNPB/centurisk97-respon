import { folded } from "./text";

const UNITS: Readonly<Record<string, number>> = {
  nol: 0,
  satu: 1,
  dua: 2,
  tiga: 3,
  empat: 4,
  lima: 5,
  enam: 6,
  tujuh: 7,
  delapan: 8,
  sembilan: 9,
  sepuluh: 10,
  sebelas: 11,
  seratus: 100,
};
const MULTIPLIERS: Readonly<Record<string, number>> = { puluh: 10, ratus: 100 };

// A dot before exactly three digits groups thousands ("1.250"), any other dot or comma is decimal.
const THOUSANDS_DOT = /(\d)\.(?=\d{3}(?!\d))/g;
const NUMERAL = /\d+(?:[.,]\d+)?/g;

// Reads written numbers left to right: thousands so far, the part below a thousand, and the
// last unit word not yet placed. "puluh", "ratus" and "belas" place only the unit before them.
function writtenNumbers(text: string, found: Set<number>): void {
  let thousands = 0;
  let below = 0;
  let unit: number | null = null;
  let open = false;
  const close = () => {
    if (open) found.add(thousands + below + (unit ?? 0));
    thousands = 0;
    below = 0;
    unit = null;
    open = false;
  };
  for (const word of text.split(/[^a-z]+/)) {
    if (Object.hasOwn(UNITS, word)) {
      below += unit ?? 0;
      unit = UNITS[word] as number;
      open = true;
    } else if (word === "seribu" || (word === "ribu" && open)) {
      // "seribu" is one thousand; "ribu" multiplies everything below a thousand before it.
      thousands += (word === "seribu" ? 1 : below + (unit ?? 0)) * 1000;
      below = 0;
      unit = null;
      open = true;
    } else if (word === "belas" && unit !== null) {
      below += unit + 10;
      unit = null;
    } else if (Object.hasOwn(MULTIPLIERS, word) && unit !== null) {
      below += unit * (MULTIPLIERS[word] as number);
      unit = null;
    } else {
      close();
    }
  }
  close();
}

// Digits followed by a number word: "3 ribu" is 3000.
const DIGITS_THEN_WORD = /(?<![\d.,])(\d+(?:[.,]\d+)?) (ribu|ratus|puluh)(?![a-z])/g;
const WORD_FACTOR: Readonly<Record<string, number>> = { ribu: 1000, ratus: 100, puluh: 10 };

// Every number a text states, in digits ("1.250", "2,5") or in Indonesian words ("dua belas").
export function findNumbers(text: string): ReadonlySet<number> {
  const words = folded(text);
  const found = new Set<number>();
  const digits = words
    .replace(THOUSANDS_DOT, "$1")
    .replace(DIGITS_THEN_WORD, (_match, numeral: string, word: string) =>
      String(Number(numeral.replace(",", ".")) * (WORD_FACTOR[word] as number)),
    );
  for (const numeral of digits.match(NUMERAL) ?? []) {
    found.add(Number(numeral.replace(",", ".")));
  }
  writtenNumbers(digits, found);
  return found;
}
